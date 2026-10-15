/**
 * Creem（Merchant of Record）收款与订阅。支付服务通过这个适配器接入，其余代码只依赖：
 *   createCheckout({ plan, userId, email, requestId, successUrl }) → 结账页地址
 *   customerPortal(customerId) → 客户门户地址（取消订阅、更换卡、下载发票）
 *   verifyWebhook(rawBody, signature) / handleWebhook(pool, event)
 *
 * 订阅权益只由已验签的 Webhook 写入。回调里的姓名、邮箱、国家等资料不入库，只保存平台对象 ID、
 * 状态、金额与币种。事件按平台事件 ID 去重；同一订阅只接受不早于已处理事件的状态。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { transaction } from '../db/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createCreemClient(config, { fetchImpl = (...args) => fetch(...args) } = {}) {
  if (!config.creem) return null;
  const { apiKey, webhookSecret, testMode, products } = config.creem;
  const base = testMode ? 'https://test-api.creem.io' : 'https://api.creem.io';

  async function post(path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`creem_${response.status}`), { status: response.status });
    return data;
  }

  const planOf = (productId) => Object.entries(products).find(([, id]) => id === productId)?.[0] || null;

  return {
    testMode,
    planOf,
    async createCheckout({ plan, userId, email, requestId, successUrl }) {
      const productId = products[plan];
      if (!productId) throw new Error('unknown_plan');
      const data = await post('/v1/checkouts', {
        product_id: productId,
        request_id: requestId,
        success_url: successUrl,
        customer: email ? { email } : undefined,
        // 只放内部用户 ID，Webhook 用它找到账户。
        metadata: { userId },
      });
      if (!data.checkout_url) throw new Error('creem_no_checkout_url');
      return data.checkout_url;
    },
    async customerPortal(customerId) {
      const data = await post('/v1/customers/billing', { customer_id: customerId });
      if (!data.customer_portal_link) throw new Error('creem_no_portal_link');
      return data.customer_portal_link;
    },
    verifyWebhook(rawBody, signature) {
      if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
      const expected = createHmac('sha256', webhookSecret).update(rawBody).digest();
      return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
    },
  };
}

const idOf = (value) => (typeof value === 'string' ? value : value?.id || null);
const dateOf = (value) => (value ? new Date(value) : null);

async function userFromMetadata(client, metadata) {
  const id = metadata?.userId;
  if (!id || !UUID.test(id)) return null;
  const { rows: [row] } = await client.query(`SELECT id FROM users WHERE id = $1 AND kind = 'member'`, [id]);
  return row?.id || null;
}

/** 写入订阅状态；比已处理事件更早的事件不覆盖新状态。 */
async function upsertSubscription(client, creem, sub, eventAt, fallbackUserId = null) {
  if (!sub?.id) return;
  const userId = (await userFromMetadata(client, sub.metadata)) || fallbackUserId;
  const productId = idOf(sub.product);
  await client.query(
    `INSERT INTO subscriptions (user_id, provider, provider_subscription_id, provider_customer_id, product_id, plan,
                                status, current_period_end, canceled_at, last_event_at)
     VALUES ($1, 'creem', $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
       user_id = COALESCE(subscriptions.user_id, EXCLUDED.user_id),
       provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
       product_id = COALESCE(EXCLUDED.product_id, subscriptions.product_id),
       plan = COALESCE(EXCLUDED.plan, subscriptions.plan),
       status = EXCLUDED.status,
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       canceled_at = EXCLUDED.canceled_at,
       last_event_at = EXCLUDED.last_event_at,
       updated_at = now()
     WHERE subscriptions.last_event_at <= EXCLUDED.last_event_at`,
    [userId, sub.id, idOf(sub.customer), productId, creem.planOf(productId), sub.status || 'active',
      dateOf(sub.current_period_end_date), dateOf(sub.canceled_at), eventAt],
  );
}

/** 记录一笔付款（金额按税前，最小货币单位）。同一交易只记一次。 */
async function recordPayment(client, creem, { orderId, subscriptionId, productId, amount, currency, userId, createdAt }) {
  if (!orderId || !Number.isInteger(amount)) return;
  await client.query(
    `INSERT INTO orders (user_id, provider, provider_order_id, provider_subscription_id, product_id, plan, amount, currency, status, created_at)
     VALUES ($1, 'creem', $2, $3, $4, $5, $6, $7, 'paid', $8)
     ON CONFLICT (provider, provider_order_id) DO NOTHING`,
    [userId, orderId, subscriptionId, productId, creem.planOf(productId), amount, String(currency || '').toUpperCase(), createdAt],
  );
}

const subscriptionUser = async (client, subscriptionId) => (subscriptionId
  ? (await client.query(`SELECT user_id FROM subscriptions WHERE provider = 'creem' AND provider_subscription_id = $1`, [subscriptionId])).rows[0]?.user_id || null
  : null);

/**
 * 处理一个已验签的事件。返回 'processed' | 'duplicate' | 'ignored'。处理失败时抛错，
 * 事件记录保留错误码，Creem 会重试，重试时重新处理（未完成的事件不算重复）。
 */
export async function handleCreemEvent(pool, creem, event) {
  const eventId = String(event?.id || '');
  const type = String(event?.eventType || '');
  const obj = event?.object || {};
  if (!eventId || !type) return 'ignored';
  const eventAt = new Date(Number(event.created_at) || Date.now());

  const { rows: [existing] } = await pool.query(
    `INSERT INTO payment_events (provider, event_id, event_type, object_id) VALUES ('creem', $1, $2, $3)
     ON CONFLICT (provider, event_id) DO UPDATE SET received_at = now()
     RETURNING processed_at`,
    [eventId, type, idOf(obj)],
  );
  if (existing.processed_at) return 'duplicate';

  try {
    await transaction(pool, async (client) => {
      if (type === 'checkout.completed') {
        const userId = await userFromMetadata(client, obj.metadata);
        // 订阅的首次付款也会收到 subscription.paid，收入只按 subscription.paid 计，避免重复；一次性订单在这里记。
        if (obj.order && obj.order.type !== 'recurring') {
          await recordPayment(client, creem, {
            orderId: obj.order.id, productId: idOf(obj.order.product), amount: obj.order.amount,
            currency: obj.order.currency, userId, createdAt: dateOf(obj.order.created_at) || eventAt,
          });
        }
        if (obj.subscription) await upsertSubscription(client, creem, { ...obj.subscription, metadata: obj.subscription.metadata || obj.metadata }, eventAt, userId);
      } else if (type.startsWith('subscription.')) {
        await upsertSubscription(client, creem, obj, eventAt, await subscriptionUser(client, obj.id));
        if (type === 'subscription.paid' && obj.last_transaction_id) {
          const product = typeof obj.product === 'object' ? obj.product : {};
          await recordPayment(client, creem, {
            orderId: obj.last_transaction_id, subscriptionId: obj.id, productId: idOf(obj.product),
            amount: product.price, currency: product.currency,
            userId: (await userFromMetadata(client, obj.metadata)) || await subscriptionUser(client, obj.id),
            createdAt: dateOf(obj.last_transaction_date) || eventAt,
          });
        }
      } else if (type === 'refund.created') {
        const tx = obj.transaction || {};
        // 退款金额含税，按交易的税前比例折算，和订单金额口径一致。
        const paid = Number(tx.amount_paid) || 0;
        const refunded = paid ? Math.round((Number(tx.refunded_amount ?? obj.refund_amount) || 0) * (Number(tx.amount) || paid) / paid) : 0;
        const subscriptionId = idOf(tx.subscription) || idOf(obj.subscription);
        await recordPayment(client, creem, {
          orderId: tx.id, subscriptionId, productId: idOf(obj.subscription?.product) || idOf(obj.order?.product),
          amount: Number(tx.amount), currency: tx.currency, userId: await subscriptionUser(client, subscriptionId), createdAt: dateOf(tx.created_at) || eventAt,
        });
        await client.query(
          `UPDATE orders SET refunded_amount = LEAST(amount, $2),
             status = CASE WHEN $2 >= amount THEN 'refunded' ELSE 'partially_refunded' END
           WHERE provider = 'creem' AND provider_order_id = $1`,
          [tx.id, refunded],
        );
        if (obj.subscription && typeof obj.subscription === 'object') await upsertSubscription(client, creem, obj.subscription, eventAt);
      } else if (type === 'dispute.created') {
        const tx = obj.transaction || {};
        if (tx.id) await client.query(`UPDATE orders SET status = 'disputed' WHERE provider = 'creem' AND provider_order_id = $1`, [tx.id]);
      }
      await client.query(`UPDATE payment_events SET processed_at = now(), error = NULL WHERE provider = 'creem' AND event_id = $1`, [eventId]);
    });
  } catch (err) {
    await pool.query(`UPDATE payment_events SET error = $2 WHERE provider = 'creem' AND event_id = $1`, [eventId, String(err.code || err.message).slice(0, 200)]);
    throw err;
  }
  return 'processed';
}
