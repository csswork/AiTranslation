/* 随扩展分发的多语言术语。词条前的标识对应上游属性或词条路径，来源与许可见 preset-terms-NOTICE.txt。 */
(() => {
  // 预设按概念维护，首选译名排在最前，后面是仅用于匹配原文的别名。
  // 来源及本项目的改译见 preset-terms-NOTICE.txt；此表只用于大模型请求。
  const cjkGarment = /面料|布料|羊毛|织物|織物|衬里|襯裡|毛衣|外套|背包|帐篷|帳篷/;
  const cjkComputing = /集群|叢集|容器|实例|實例|网络|網路|端点|端點|DNS|Kubernetes/i;
  const garment = {
    'zh-Hans': cjkGarment, 'zh-Hant': cjkGarment,
    en: /\b(?:fabrics?|textiles?|linings?|coats?|sweaters?|scarves|jackets?|bags?|seams?|tents?|backpacks?|wool)\b/i,
    ja: /生地|布地|表地|裏地|素材|繊維|縫い目|混紡|衣類|バッグ|ジャケット|コート|セーター|マフラー|テント/,
    fr: /\b(?:tissus?|vestes?|manteaux?|pulls?|laine)\b/i,
    de: /stoff|mantel|pullover|jacke|wolle/i,
    es: /\b(?:telas?|abrigos?|chaquetas?|suéter|lana)\b/i,
    ar: /قماش|نسيج|معطف|سترة|صوف|حقيبة|خيمة/,
  };
  const computing = {
    'zh-Hans': cjkComputing, 'zh-Hant': cjkComputing,
    en: /\b(?:network|cluster|endpoint|server|instance|container|kubernetes|dns|microservice|registry|client)s?\b/i,
    ja: /ネットワーク|クラスタ|エンドポイント|サーバ|インスタンス|コンテナ|マイクロサービス|レジストリ|クライアント|DNS|Kubernetes/i,
    fr: /réseau|serveur|conteneur|instance|client|DNS|Kubernetes/i,
    de: /netzwerk|server|container|instanz|client|DNS|Kubernetes/i,
    es: /\b(?:red|redes|servidores?|servidor|instancias?|contenedores?|contenedor|cliente|DNS|Kubernetes)\b/i,
    ar: /خادم|خوادم|حاوي|الشبكة|نقطة نهاية|DNS|Kubernetes/i,
  };
  // 容易与物流、图像缩放等用法混淆的概念，要求同一项出现软件语境。
  const software = {
    en: /\b(?:servers?|instances?|containers?|clusters?|pipelines?|deploy(?:s|ed|ment)?|releases?|workloads?|code|software|builds?|registry|Kubernetes|CI)\b/i,
    ja: /サーバ|インスタンス|コンテナ|クラスタ|パイプライン|デプロイ|リリース|コード|ビルド|レジストリ|Kubernetes|CI/i,
    'zh-Hans': /服务[器端]|实例|容器|集群|流水线|部署|发布|软件|代码|构建|镜像仓库|Kubernetes|CI/i,
    'zh-Hant': /伺服器|執行個體|容器|叢集|管線|部署|發布|發佈|軟體|程式碼|建置|Kubernetes|CI/i,
    fr: /serveur|instance|conteneur|cluster|pipeline|déploiement|logiciel|code|Kubernetes|\bCI\b/i,
    de: /server|instanz|container|cluster|pipeline|deployment|software|build|quellcode|Kubernetes|\bCI\b/i,
    es: /servidor|instancia|contenedor|clúster|pipeline|despliegue|software|código|Kubernetes|\bCI\b/i,
    ar: /خادم|خوادم|مثيل|حاوي|عنقود|برنامج|برمجيات|شفرة|الشيفرة|نشر|Kubernetes|\bCI\b/i,
  };
  globalThis.AITrPresetTerms = [
    // fabric_treatment__water_repellent
    { context: garment, names: {
      'zh-Hans': '防泼水处理', 'zh-Hant': '防潑水處理', en: ['water-repellent finish', 'water repellent finish'], ja: '撥水加工',
      fr: 'traitement déperlant', de: 'wasserabweisende Ausrüstung', es: 'acabado repelente al agua', ar: 'معالجة طاردة للماء',
    } },
    // outdoor_equipment_features__water_repellent
    { context: garment, names: {
      'zh-Hans': '防泼水', 'zh-Hant': '防潑水', en: ['water-repellent', 'water repellent'], ja: '撥水',
      fr: ['déperlant', 'déperlante'], de: ['wasserabweisend', 'wasserabweisende', 'wasserabweisender', 'wasserabweisendes'],
      es: 'repelente al agua', ar: ['طارد للماء', 'طاردة للماء'],
    } },
    // 羊绒在西文和阿拉伯语中也可能是地名。出现明显地名用法时，即使同段提到衣物也跳过。
    // fabric__cashmere
    { context: garment, exclude: /\b(?:(?:in|near|visited) cashmere|au cachemire|in kaschmir|(?:en|desde) cachemira)\b|(?:في|إقليم) كشمير/iu, names: {
      'zh-Hans': '羊绒', 'zh-Hant': '羊絨', en: 'cashmere', ja: 'カシミヤ', fr: 'cachemire', de: 'Kaschmir', es: 'cachemira', ar: ['كشمير', 'كاشمير'],
    } },
    // office_supply_material__ripstop
    { names: {
      'zh-Hans': '防撕裂尼龙', 'zh-Hant': '防撕裂尼龍', en: 'ripstop nylon', ja: 'リップストップナイロン',
      fr: 'nylon ripstop', de: 'Ripstop-Nylon', es: 'nailon antidesgarro', ar: 'نايلون مقاوم للتمزق',
    } },
    // service-mesh
    { names: {
      'zh-Hans': '服务网格', 'zh-Hant': '服務網格', en: 'service mesh', ja: 'サービスメッシュ',
      fr: 'maillage de services', de: 'Service Mesh', es: 'malla de servicios', ar: 'شبكة الخدمات',
    } },
    // service-discovery
    { context: computing, names: {
      'zh-Hans': '服务发现', 'zh-Hant': '服務發現', en: 'service discovery', ja: 'サービスディスカバリー',
      fr: 'découverte de services', de: 'Service Discovery', es: ['descubrimiento de servicios', 'descubrimiento de servicio'], ar: ['اكتشاف الخدمات', 'اكتشاف الخدمة'],
    } },
    // abrasive_material__aluminum_oxide
    { names: {
      'zh-Hans': '氧化铝', 'zh-Hant': '氧化鋁', en: ['aluminum oxide', 'aluminium oxide'], ja: ['酸化アルミニウム', 'アルミナ'],
      fr: ['oxyde d’aluminium', 'oxyde d\'aluminium'], de: 'Aluminiumoxid', es: 'óxido de aluminio', ar: ['أكسيد الألومنيوم', 'أكسيد الألمنيوم'],
    } },
    // abrasive_material__silicon_carbide
    { names: {
      'zh-Hans': '碳化硅', 'zh-Hant': '碳化矽', en: 'silicon carbide', ja: ['炭化ケイ素', '炭化けい素'],
      fr: 'carbure de silicium', de: ['Siliciumcarbid', 'Siliziumkarbid'], es: 'carburo de silicio', ar: 'كربيد السيليكون',
    } },
    // abrasive_material__steel_wool
    { names: {
      'zh-Hans': '钢丝绒', 'zh-Hant': '鋼絲絨', en: 'steel wool', ja: 'スチールウール',
      fr: ['laine d’acier', 'laine d\'acier'], de: 'Stahlwolle', es: 'lana de acero', ar: ['صوف فولاذي', 'الصوف الفولاذي'],
    } },
    // accessory_material__carbon_fiber
    { names: {
      'zh-Hans': '碳纤维', 'zh-Hant': '碳纖維', en: ['carbon fiber', 'carbon fibre'], ja: ['炭素繊維', 'カーボンファイバー'],
      fr: ['fibre de carbone', 'fibres de carbone'], de: ['Kohlenstofffaser', 'Kohlenstofffasern', 'Carbonfaser'], es: 'fibra de carbono', ar: 'ألياف الكربون',
    } },
    // accessory_material__carbon_steel
    { names: {
      'zh-Hans': '碳钢', 'zh-Hant': '碳鋼', en: 'carbon steel', ja: '炭素鋼',
      fr: 'acier au carbone', de: 'Kohlenstoffstahl', es: 'acero al carbono', ar: ['فولاذ كربوني', 'الفولاذ الكربوني'],
    } },
    // accessory_material__fiberglass
    { context: { de: /material|faserverstärkt|gewebe|matte|kunststoff|schale|strebe|laminat|dämmung|verbund|harz|verstärkung/i },
      exclude: /Glasfaser.{0,24}(?:Internet|Anschluss|Breitband|Tarif)|(?:Internet|Breitband).{0,24}Glasfaser/i, names: {
      'zh-Hans': '玻璃纤维', 'zh-Hant': '玻璃纖維', en: ['fiberglass', 'fibreglass', 'glass fiber', 'glass fibre'], ja: ['ガラス繊維', 'グラスファイバー'],
      fr: 'fibre de verre', de: 'Glasfaser', es: 'fibra de vidrio', ar: ['ألياف زجاجية', 'الألياف الزجاجية'],
    } },
    // accessory_material__stainless_steel
    { names: {
      'zh-Hans': '不锈钢', 'zh-Hant': '不鏽鋼', en: 'stainless steel', ja: 'ステンレス鋼',
      fr: 'acier inoxydable', de: ['nichtrostender Stahl', 'rostfreier Stahl'], es: 'acero inoxidable', ar: ['فولاذ مقاوم للصدأ', 'الفولاذ المقاوم للصدأ'],
    } },
    // acoustic_piano_plate_frame_material__aluminum_alloy
    { names: {
      'zh-Hans': '铝合金', 'zh-Hant': '鋁合金', en: ['aluminum alloy', 'aluminium alloy'], ja: ['アルミニウム合金', 'アルミ合金'],
      fr: ['alliage d’aluminium', 'alliage d\'aluminium'], de: 'Aluminiumlegierung', es: 'aleación de aluminio', ar: ['سبيكة ألومنيوم', 'سبائك الألومنيوم'],
    } },
    // acoustic_piano_plate_frame_material__cast_iron
    { context: { fr: /poêle|cocotte|marmite|radiateur|grille|ustensile|métal|alliage|châssis|tuyau|plaque|piano/i }, exclude: /cast[- ]iron (?:guarantee|alibi|promise|stomach)|fonte des? (?:glaciers?|neiges?|glaces?)/i, names: {
      'zh-Hans': '铸铁', 'zh-Hant': '鑄鐵', en: 'cast iron', ja: '鋳鉄',
      fr: ['fonte', 'fonte de fer'], de: 'Gusseisen', es: 'hierro fundido', ar: ['حديد زهر', 'الحديد الزهر'],
    } },
    // air_purifier_filter_technology__activated_carbon
    { names: {
      'zh-Hans': '活性炭', 'zh-Hant': '活性碳', en: ['activated carbon', 'activated charcoal'], ja: '活性炭',
      fr: ['charbon actif', 'charbon activé'], de: 'Aktivkohle', es: ['carbón activado', 'carbón activo'], ar: ['كربون منشط', 'الكربون المنشط', 'فحم نشط', 'الفحم النشط'],
    } },
    // air_purifier_filter_technology__activated_carbon
    { names: {
      'zh-Hans': ['活性炭过滤器', '活性炭滤网'], 'zh-Hant': ['活性碳濾網', '活性碳過濾器'], en: ['activated carbon filter', 'activated carbon filters'], ja: ['活性炭フィルター', '活性炭フィルタ'],
      fr: 'filtre à charbon actif', de: 'Aktivkohlefilter', es: 'filtro de carbón activado', ar: ['مرشح كربون منشط', 'مرشح الكربون المنشط'],
    } },
    // air_purifier_filter_technology__hepa
    { names: {
      'zh-Hans': ['HEPA 滤网', 'HEPA滤网', 'HEPA过滤器'], 'zh-Hant': ['HEPA 濾網', 'HEPA濾網', 'HEPA過濾器'], en: ['HEPA filter', 'HEPA filters'], ja: ['HEPAフィルター', 'HEPAフィルタ'],
      fr: 'filtre HEPA', de: 'HEPA-Filter', es: 'filtro HEPA', ar: ['مرشح HEPA', 'فلتر HEPA'],
    } },
    // aquarium_filter_features__multi_stage_filtration
    { names: {
      'zh-Hans': '多级过滤', 'zh-Hant': '多級過濾', en: ['multi-stage filtration', 'multistage filtration'], ja: ['多段ろ過', '多段濾過'],
      fr: 'filtration à plusieurs étages', de: 'mehrstufige Filtration', es: 'filtración multietapa', ar: ['ترشيح متعدد المراحل', 'الترشيح متعدد المراحل'],
    } },
    // anti_g_suit_bladder_material__thermoplastic_polyurethane_tpu
    { names: {
      'zh-Hans': '热塑性聚氨酯', 'zh-Hant': '熱塑性聚氨酯', en: 'thermoplastic polyurethane', ja: '熱可塑性ポリウレタン',
      fr: 'polyuréthane thermoplastique', de: 'thermoplastisches Polyurethan', es: 'poliuretano termoplástico', ar: ['بولي يوريثان لدن حراريا', 'البولي يوريثان اللدن حراريا'],
    } },
    // airship_envelope_material__polyurethane_pu_film
    { names: {
      'zh-Hans': '聚氨酯薄膜', 'zh-Hant': '聚氨酯薄膜', en: 'polyurethane film', ja: 'ポリウレタンフィルム',
      fr: 'film de polyuréthane', de: 'Polyurethanfolie', es: 'película de poliuretano', ar: 'غشاء من البولي يوريثان',
    } },
    // art/crafting_tool_material__faux_leather
    { names: {
      'zh-Hans': ['人造革', '仿皮革'], 'zh-Hant': '人造皮革', en: ['faux leather', 'artificial leather'], ja: ['フェイクレザー', '人工皮革'],
      fr: 'similicuir', de: 'Kunstleder', es: ['piel sintética', 'cuero sintético'], ar: ['جلد صناعي', 'الجلد الصناعي'],
    } },
    // art/crafting_tool_material__low_density_polyethylene_ldpe
    { names: {
      'zh-Hans': '低密度聚乙烯', 'zh-Hant': '低密度聚乙烯', en: ['low-density polyethylene', 'low density polyethylene'], ja: '低密度ポリエチレン',
      fr: 'polyéthylène basse densité', de: 'Polyethylen niedriger Dichte', es: 'polietileno de baja densidad', ar: ['بولي إيثيلين منخفض الكثافة', 'البولي إيثيلين منخفض الكثافة'],
    } },
    // art/crafting_tool_material__polylactic_acid_pla
    { names: {
      'zh-Hans': '聚乳酸', 'zh-Hant': '聚乳酸', en: 'polylactic acid', ja: 'ポリ乳酸',
      fr: 'acide polylactique', de: 'Polymilchsäure', es: 'ácido poliláctico', ar: 'حمض البولي لاكتيك',
    } },
    // art/crafting_tool_material__polyvinyl_chloride_pvc
    { names: {
      'zh-Hans': '聚氯乙烯', 'zh-Hant': '聚氯乙烯', en: 'polyvinyl chloride', ja: ['ポリ塩化ビニル', 'ポリ塩化ビニール'],
      fr: 'polychlorure de vinyle', de: 'Polyvinylchlorid', es: 'policloruro de vinilo', ar: 'بولي كلوريد الفينيل',
    } },
    // anchor_connection_type__screwgate_carabiner
    { names: {
      'zh-Hans': '丝扣主锁', 'zh-Hant': '螺旋鎖門鉤環', en: ['screwgate carabiner', 'screw-lock carabiner'], ja: 'スクリューロック式カラビナ',
      fr: 'mousqueton à vis', de: 'Schraubkarabiner', es: 'mosquetón de rosca', ar: 'حلقة تسلق بقفل لولبي',
    } },
    // air_purifier_filter_technology__nanofiber
    { names: {
      'zh-Hans': '纳米纤维', 'zh-Hant': '奈米纖維', en: ['nanofiber', 'nanofibre', 'nanofibers', 'nanofibres'], ja: 'ナノファイバー',
      fr: ['nanofibre', 'nanofibres'], de: ['Nanofaser', 'Nanofasern'], es: ['nanofibra', 'nanofibras'], ar: ['ألياف نانوية', 'الألياف النانوية'],
    } },
    // airship_envelope_material__neoprene_coated_fabric
    { names: {
      'zh-Hans': '氯丁橡胶涂层织物', 'zh-Hant': '氯丁橡膠塗層織物', en: ['neoprene-coated fabric', 'neoprene coated fabric'], ja: 'ネオプレンコーティング生地',
      fr: 'tissu enduit de néoprène', de: 'neoprenbeschichtetes Gewebe', es: 'tejido recubierto de neopreno', ar: 'نسيج مطلي بالنيوبرين',
    } },
    // project/merino-wool
    { names: {
      'zh-Hans': '美利奴羊毛', 'zh-Hant': '美麗諾羊毛', en: 'merino wool', ja: 'メリノウール',
      fr: 'laine mérinos', de: 'Merinowolle', es: ['lana merina', 'lana de merino'], ar: ['صوف ميرينو', 'صوف الميرينو'],
    } },
    // project/lyocell
    { names: {
      'zh-Hans': ['莱赛尔纤维', '莱赛尔'], 'zh-Hant': ['萊賽爾纖維', '萊賽爾'], en: 'lyocell', ja: 'リヨセル',
      fr: 'lyocell', de: 'Lyocell', es: ['liocel', 'lyocell'], ar: 'ليوسيل',
    } },
    // project/elastane
    { names: {
      'zh-Hans': '氨纶', 'zh-Hant': '聚氨酯彈性纖維', en: ['elastane', 'spandex'], ja: ['ポリウレタン弾性繊維', 'エラスタン', 'スパンデックス'],
      fr: ['élasthanne', 'élasthane'], de: 'Elasthan', es: 'elastano', ar: 'إيلاستان',
    } },
    // project/microfiber
    { names: {
      'zh-Hans': '超细纤维', 'zh-Hant': '超細纖維', en: ['microfiber', 'microfibre', 'microfibers', 'microfibres'], ja: 'マイクロファイバー',
      fr: ['microfibre', 'microfibres'], de: ['Mikrofaser', 'Mikrofasern'], es: ['microfibra', 'microfibras'], ar: ['ألياف دقيقة', 'الألياف الدقيقة'],
    } },
    // project/full-grain-leather
    { names: {
      'zh-Hans': '全粒面皮革', 'zh-Hant': '全粒面皮革', en: ['full-grain leather', 'full grain leather'], ja: 'フルグレインレザー',
      fr: 'cuir pleine fleur', de: 'Vollnarbenleder', es: ['cuero de plena flor', 'cuero de grano completo'], ar: ['جلد كامل الحبيبات', 'الجلد كامل الحبيبات'],
    } },
    // arrow/bolt_material__carbon_fiber_reinforced_polymer_cfrp
    { names: {
      'zh-Hans': '碳纤维增强聚合物', 'zh-Hant': '碳纖維強化聚合物', en: ['carbon fiber reinforced polymer', 'carbon-fiber-reinforced polymer', 'carbon fibre reinforced polymer'], ja: ['炭素繊維強化プラスチック', '炭素繊維強化ポリマー'],
      fr: 'polymère renforcé de fibres de carbone', de: 'kohlenstofffaserverstärkter Kunststoff', es: 'polímero reforzado con fibra de carbono', ar: 'بوليمر مقوى بألياف الكربون',
    } },
    // api-gateway
    { names: {
      'zh-Hans': ['API 网关', 'API网关'], 'zh-Hant': ['API 閘道器', 'API閘道器'], en: ['API gateway', 'API gateways'], ja: 'APIゲートウェイ',
      fr: ['passerelle d’API', 'passerelle d\'API', 'passerelle API'], de: ['API-Gateway', 'API Gateway'], es: ['puerta de enlace de API', 'API gateway'], ar: ['بوابة API', 'بوابة واجهة برمجة التطبيقات'],
    } },
    // application-programming-interface
    { names: {
      'zh-Hans': ['应用程序编程接口', '应用程序接口'], 'zh-Hant': ['應用程式介面', '應用程式設計介面'], en: ['application programming interface', 'application programming interfaces'], ja: ['アプリケーションプログラミングインターフェース', 'アプリケーションプログラミングインタフェース'],
      fr: ['interface de programmation d’application', 'interface de programmation d\'application'], de: ['Programmierschnittstelle', 'Programmierschnittstellen'], es: 'interfaz de programación de aplicaciones', ar: 'واجهة برمجة التطبيقات',
    } },
    // auto-scaling
    { context: software, names: {
      'zh-Hans': ['自动伸缩', '自动扩缩容'], 'zh-Hant': '自動擴縮', en: ['autoscaling', 'auto-scaling', 'auto scaling'], ja: 'オートスケーリング',
      fr: ['mise à l’échelle automatique', 'mise à l\'échelle automatique'], de: 'automatische Skalierung', es: ['escalado automático', 'autoescalado'], ar: ['توسع تلقائي', 'التوسع التلقائي'],
    } },
    // blue-green-deployment
    { names: {
      'zh-Hans': '蓝绿部署', 'zh-Hant': '藍綠部署', en: ['blue-green deployment', 'blue green deployment'], ja: ['ブルーグリーンデプロイメント', 'ブルーグリーンデプロイ'],
      fr: ['déploiement bleu-vert', 'déploiement bleu/vert'], de: ['Blue-Green-Deployment', 'Blue Green Deployment'], es: ['despliegue azul-verde', 'despliegue blue green'], ar: ['نشر أزرق وأخضر', 'النشر الأزرق والأخضر'],
    } },
    // canary-deployment
    { names: {
      'zh-Hans': '金丝雀部署', 'zh-Hant': '金絲雀部署', en: ['canary deployment', 'canary deployments'], ja: ['カナリアデプロイメント', 'カナリアデプロイ'],
      fr: 'déploiement canari', de: ['Canary-Deployment', 'Canary Deployment'], es: ['despliegue canario', 'canary deployment'], ar: 'نشر الكناري',
    } },
    // chaos-engineering
    { names: {
      'zh-Hans': '混沌工程', 'zh-Hant': '混沌工程', en: 'chaos engineering', ja: 'カオスエンジニアリング',
      fr: 'ingénierie du chaos', de: ['Chaos Engineering', 'Chaos-Engineering'], es: 'ingeniería del caos', ar: 'هندسة الفوضى',
    } },
    // cloud-computing
    { names: {
      'zh-Hans': '云计算', 'zh-Hant': '雲端運算', en: 'cloud computing', ja: 'クラウドコンピューティング',
      fr: ['informatique en nuage', 'cloud computing'], de: ['Cloud-Computing', 'Cloud Computing'], es: 'computación en la nube', ar: ['حوسبة سحابية', 'الحوسبة السحابية'],
    } },
    // container-image
    { names: {
      'zh-Hans': '容器镜像', 'zh-Hant': ['容器映像檔', '容器映像'], en: ['container image', 'container images'], ja: 'コンテナイメージ',
      fr: ['image de conteneur', 'images de conteneurs'], de: ['Container-Image', 'Container-Images'], es: ['imagen de contenedor', 'imágenes de contenedores'], ar: ['صورة حاوية', 'صورة الحاوية', 'صور الحاويات'],
    } },
    // container-orchestration
    { names: {
      'zh-Hans': '容器编排', 'zh-Hant': ['容器編排', '容器協調'], en: 'container orchestration', ja: 'コンテナオーケストレーション',
      fr: 'orchestration de conteneurs', de: 'Container-Orchestrierung', es: 'orquestación de contenedores', ar: 'تنسيق الحاويات',
    } },
    // continuous-delivery
    { context: software, names: {
      'zh-Hans': '持续交付', 'zh-Hant': '持續交付', en: 'continuous delivery', ja: ['継続的デリバリー', '継続的デリバリ'],
      fr: 'livraison continue', de: ['Continuous Delivery', 'kontinuierliche Auslieferung'], es: 'entrega continua', ar: ['تسليم مستمر', 'التسليم المستمر'],
    } },
    // continuous-deployment
    { names: {
      'zh-Hans': '持续部署', 'zh-Hant': '持續部署', en: 'continuous deployment', ja: ['継続的デプロイメント', '継続的デプロイ'],
      fr: 'déploiement continu', de: ['Continuous Deployment', 'kontinuierliche Bereitstellung'], es: 'despliegue continuo', ar: ['نشر مستمر', 'النشر المستمر'],
    } },
    // continuous-integration
    { names: {
      'zh-Hans': '持续集成', 'zh-Hant': '持續整合', en: 'continuous integration', ja: '継続的インテグレーション',
      fr: 'intégration continue', de: ['kontinuierliche Integration', 'Continuous Integration'], es: 'integración continua', ar: ['تكامل مستمر', 'التكامل المستمر'],
    } },
    // distributed-systems
    { names: {
      'zh-Hans': '分布式系统', 'zh-Hant': '分散式系統', en: ['distributed system', 'distributed systems'], ja: '分散システム',
      fr: ['système distribué', 'systèmes distribués'], de: ['verteiltes System', 'verteilte Systeme'], es: ['sistema distribuido', 'sistemas distribuidos'], ar: ['نظام موزع', 'النظام الموزع', 'أنظمة موزعة'],
    } },
    // edge-computing
    { names: {
      'zh-Hans': '边缘计算', 'zh-Hant': '邊緣運算', en: 'edge computing', ja: 'エッジコンピューティング',
      fr: ['informatique en périphérie', 'edge computing'], de: ['Edge-Computing', 'Edge Computing'], es: ['computación en el borde', 'computación perimetral'], ar: ['حوسبة الحافة', 'الحوسبة الطرفية'],
    } },
    // event-driven-architecture
    { names: {
      'zh-Hans': '事件驱动架构', 'zh-Hant': '事件驅動架構', en: ['event-driven architecture', 'event driven architecture'], ja: 'イベント駆動アーキテクチャ',
      fr: ['architecture événementielle', 'architecture orientée événements'], de: 'ereignisgesteuerte Architektur', es: ['arquitectura basada en eventos', 'arquitectura dirigida por eventos'], ar: ['معمارية قائمة على الأحداث', 'المعمارية القائمة على الأحداث'],
    } },
    // function-as-a-service
    { names: {
      'zh-Hans': '函数即服务', 'zh-Hant': '函式即服務', en: ['function as a service', 'functions as a service'], ja: ['Function as a Service', 'サービスとしての関数'],
      fr: 'fonction en tant que service', de: 'Function as a Service', es: 'función como servicio', ar: 'الدوال كخدمة',
    } },
    // horizontal-scaling
    { context: software, names: {
      'zh-Hans': ['水平伸缩', '横向扩缩容'], 'zh-Hant': '水平擴展', en: 'horizontal scaling', ja: '水平スケーリング',
      fr: ['mise à l’échelle horizontale', 'mise à l\'échelle horizontale'], de: 'horizontale Skalierung', es: 'escalado horizontal', ar: ['توسع أفقي', 'التوسع الأفقي'],
    } },
    // immutable-infrastructure
    { names: {
      'zh-Hans': '不可变基础设施', 'zh-Hant': '不可變基礎設施', en: 'immutable infrastructure', ja: ['イミュータブルインフラストラクチャ', 'イミュータブルインフラ'],
      fr: 'infrastructure immuable', de: 'unveränderliche Infrastruktur', es: 'infraestructura inmutable', ar: ['بنية تحتية غير قابلة للتغيير', 'البنية التحتية غير القابلة للتغيير'],
    } },
    // infrastructure-as-code
    { names: {
      'zh-Hans': '基础设施即代码', 'zh-Hant': '基礎設施即程式碼', en: 'infrastructure as code', ja: ['Infrastructure as Code', 'コードとしてのインフラストラクチャ'],
      fr: 'infrastructure en tant que code', de: 'Infrastructure as Code', es: 'infraestructura como código', ar: ['البنية التحتية كرمز', 'البنية التحتية ككود'],
    } },
    // load-balancer
    { names: {
      'zh-Hans': '负载均衡器', 'zh-Hant': '負載平衡器', en: ['load balancer', 'load balancers'], ja: ['ロードバランサー', 'ロードバランサ'],
      fr: ['répartiteur de charge', 'équilibreur de charge'], de: ['Lastverteiler', 'Load Balancer'], es: 'balanceador de carga', ar: ['موازن أحمال', 'موازن الأحمال'],
    } },
    // microservices-architecture
    { names: {
      'zh-Hans': '微服务架构', 'zh-Hant': '微服務架構', en: ['microservices architecture', 'microservice architecture'], ja: 'マイクロサービスアーキテクチャ',
      fr: 'architecture en microservices', de: ['Microservice-Architektur', 'Microservices-Architektur'], es: 'arquitectura de microservicios', ar: 'معمارية الخدمات المصغرة',
    } },
    // platform-as-a-service
    { names: {
      'zh-Hans': '平台即服务', 'zh-Hant': '平台即服務', en: 'platform as a service', ja: ['Platform as a Service', 'サービスとしてのプラットフォーム'],
      fr: 'plateforme en tant que service', de: 'Platform as a Service', es: 'plataforma como servicio', ar: 'المنصة كخدمة',
    } },
    // policy-as-code
    { names: {
      'zh-Hans': '策略即代码', 'zh-Hant': '政策即程式碼', en: 'policy as code', ja: ['Policy as Code', 'コードとしてのポリシー'],
      fr: 'politique en tant que code', de: 'Policy as Code', es: 'política como código', ar: ['السياسات كرمز', 'السياسات ككود'],
    } },
    // role-based-access-control
    { names: {
      'zh-Hans': '基于角色的访问控制', 'zh-Hant': '以角色為基礎的存取控制', en: ['role-based access control', 'role based access control'], ja: 'ロールベースアクセス制御',
      fr: ['contrôle d’accès basé sur les rôles', 'contrôle d\'accès basé sur les rôles'], de: 'rollenbasierte Zugriffskontrolle', es: 'control de acceso basado en roles', ar: ['التحكم في الوصول المستند إلى الأدوار', 'التحكم في الوصول بناء على الأدوار'],
    } },
    // sidecar-container
    { names: {
      'zh-Hans': '边车容器', 'zh-Hant': '邊車容器', en: ['sidecar container', 'sidecar containers'], ja: 'サイドカーコンテナ',
      fr: 'conteneur sidecar', de: 'Sidecar-Container', es: 'contenedor sidecar', ar: ['حاوية جانبية', 'الحاوية الجانبية'],
    } },
    // site-reliability-engineering
    { names: {
      'zh-Hans': ['站点可靠性工程', '网站可靠性工程'], 'zh-Hant': '網站可靠性工程', en: 'site reliability engineering', ja: 'サイト信頼性エンジニアリング',
      fr: 'ingénierie de la fiabilité des sites', de: 'Site Reliability Engineering', es: ['ingeniería de fiabilidad de sitios', 'site reliability engineering'], ar: 'هندسة موثوقية المواقع',
    } },
    // vertical-scaling
    { context: software, names: {
      'zh-Hans': ['垂直伸缩', '纵向扩缩容'], 'zh-Hant': '垂直擴展', en: 'vertical scaling', ja: '垂直スケーリング',
      fr: ['mise à l’échelle verticale', 'mise à l\'échelle verticale'], de: 'vertikale Skalierung', es: 'escalado vertical', ar: ['توسع رأسي', 'التوسع الرأسي', 'التوسع العمودي'],
    } },
    // virtual-machine
    { names: {
      'zh-Hans': '虚拟机', 'zh-Hant': '虛擬機器', en: ['virtual machine', 'virtual machines'], ja: '仮想マシン',
      fr: ['machine virtuelle', 'machines virtuelles'], de: ['virtuelle Maschine', 'virtuelle Maschinen'], es: ['máquina virtual', 'máquinas virtuales'], ar: ['آلة افتراضية', 'الآلة الافتراضية', 'جهاز افتراضي'],
    } },
    // zero-trust-architecture
    { names: {
      'zh-Hans': '零信任架构', 'zh-Hant': '零信任架構', en: ['zero trust architecture', 'zero-trust architecture'], ja: 'ゼロトラストアーキテクチャ',
      fr: 'architecture zéro confiance', de: 'Zero-Trust-Architektur', es: 'arquitectura de confianza cero', ar: 'معمارية الثقة الصفرية',
    } },
    // image-digest
    { context: software, names: {
      'zh-Hans': '镜像摘要', 'zh-Hant': '映像檔摘要', en: ['image digest', 'image digests'], ja: 'イメージダイジェスト',
      fr: ['empreinte de l’image', 'empreinte de l\'image'], de: 'Image-Digest', es: 'resumen criptográfico de la imagen', ar: 'بصمة صورة الحاوية',
    } },
  ];
})();
