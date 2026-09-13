/**
 * 特別塗装機（登録記号 → 説明）。ここに追記すれば UI で自動的にハイライトされる。
 */
export const SPECIAL_LIVERIES = {
  // JAL（日本航空）
  'JA01XJ': { airline: 'JAL', type: 'A350-900', name: 'A350 導入記念 1号機', note: '赤色「AIRBUS A350」ロゴ', color: '#d7263d' },
  'JA02XJ': { airline: 'JAL', type: 'A350-900', name: 'A350 導入記念 2号機', note: 'シルバー「AIRBUS A350」ロゴ', color: '#8a8f98' },
  'JA03XJ': { airline: 'JAL', type: 'A350-900', name: 'A350 導入記念 3号機', note: '緑色「AIRBUS A350」ロゴ', color: '#2a9d4b' },
  'JA15XJ': { airline: 'JAL', type: 'A350-900', name: 'oneworld アライアンス塗装機', note: 'ワンワールド特別塗装', color: '#1f4e9c' },
  'JA339J': { airline: 'JAL', type: 'B737-800', name: 'JAL Jubilee Express', note: '東京ディズニーシー25周年記念', color: '#7b3fa0' },
  'JA228J': { airline: 'J-AIR', type: 'E170', name: 'J-AIR 30th Anniversary JET', note: 'ジェイエア30周年記念', color: '#c8102e' },
  // ANA（全日本空輸）
  'JA819A': { airline: 'ANA', type: 'B787-8', name: 'ピカチュウジェット NH', note: 'ポケモン特別塗装', color: '#f4c20d' },
  'JA923A': { airline: 'ANA', type: 'B787-9', name: 'イーブイジェット NH', note: 'ポケモン特別塗装', color: '#b5651d' },
  'JA58AN': { airline: 'ANA', type: 'B737-800', name: 'ANA ふるさと JET', note: '地域応援特別塗装', color: '#1e5aa8' },
  // スカイマーク
  'JA73AB': { airline: 'Skymark', type: 'B737-800', name: 'ピカチュウジェットBC 1号機', note: '黄色・風船デザイン', color: '#f4c20d' },
  'JA73NG': { airline: 'Skymark', type: 'B737-800', name: 'ピカチュウジェットBC 2号機', note: 'ホエルオーデザイン', color: '#3a8fd9' }
};

/** ICAO 3レター（コールサイン先頭）→ 航空会社名 */
export const AIRLINES = {
  JAL: '日本航空', ANA: '全日空', SKY: 'スカイマーク', JJP: 'ジェットスター・ジャパン', APJ: 'Peach',
  SFJ: 'スターフライヤー', SNJ: 'ソラシドエア', ADO: 'AIRDO', IBX: 'IBEX', FDA: 'フジドリームエアラインズ',
  JTA: '日本トランスオーシャン航空', JAC: '日本エアコミューター', RAC: '琉球エアーコミューター', AKX: 'ANAウイングス',
  JLJ: 'ジェイエア', ORC: 'オリエンタルエアブリッジ', HAC: '北海道エアシステム', TZP: 'ZIPAIR', SJO: 'スプリング・ジャパン',
  AJX: 'エアージャパン', NCA: '日本貨物航空', TOK: 'トキエア', AMX: '天草エアライン', NJA: '新中央航空',
  UAL: 'ユナイテッド航空', DAL: 'デルタ航空', AAL: 'アメリカン航空', HAL: 'ハワイアン航空', ACA: 'エア・カナダ',
  CPA: 'キャセイパシフィック', HKE: '香港エクスプレス', CAL: 'チャイナエアライン', EVA: 'エバー航空', SJX: 'スターラックス航空', TTW: 'タイガーエア台湾',
  KAL: '大韓航空', AAR: 'アシアナ航空', JNA: 'ジンエアー', JJA: 'チェジュ航空', TWB: 'ティーウェイ航空', ABL: 'エアプサン', ESR: 'イースター航空', ASV: 'エアソウル',
  CCA: '中国国際航空', CES: '中国東方航空', CSN: '中国南方航空', CHH: '海南航空', CXA: '厦門航空', CSC: '四川航空', CQH: '春秋航空', DKH: '吉祥航空', CSS: '順豊航空',
  SIA: 'シンガポール航空', SLK: 'シルクエアー', TGW: 'スクート', THA: 'タイ国際航空', MAS: 'マレーシア航空', GIA: 'ガルーダ', PAL: 'フィリピン航空', CEB: 'セブパシフィック',
  VJC: 'ベトジェット', HVN: 'ベトナム航空', AXM: 'エアアジア', QFA: 'カンタス航空', JST: 'ジェットスター', ANZ: 'ニュージーランド航空',
  UAE: 'エミレーツ', QTR: 'カタール航空', ETD: 'エティハド', THY: 'ターキッシュ', BAW: 'ブリティッシュ・エアウェイズ', DLH: 'ルフトハンザ', AFR: 'エールフランス',
  KLM: 'KLM', FIN: 'フィンエアー', SAS: 'SAS', SWR: 'スイス', ITY: 'ITAエアウェイズ', AFL: 'アエロフロート', ETH: 'エチオピア航空',
  FDX: 'FedEx', UPS: 'UPS', GTI: 'アトラス航空', CLX: 'カーゴルクス', ABW: 'エアブリッジカーゴ'
};

/** ICAO 機種コード → 表示名 */
export const AIRCRAFT_TYPES = {
  A19N: 'A319neo', A20N: 'A320neo', A21N: 'A321neo', A318: 'A318', A319: 'A319', A320: 'A320', A321: 'A321',
  A332: 'A330-200', A333: 'A330-300', A338: 'A330-800', A339: 'A330-900', A342: 'A340-200', A343: 'A340-300', A345: 'A340-500', A346: 'A340-600',
  A359: 'A350-900', A35K: 'A350-1000', A388: 'A380-800',
  B37M: 'B737 MAX 7', B38M: 'B737 MAX 8', B39M: 'B737 MAX 9', B3XM: 'B737 MAX 10',
  B733: 'B737-300', B734: 'B737-400', B735: 'B737-500', B736: 'B737-600', B737: 'B737-700', B738: 'B737-800', B739: 'B737-900',
  B744: 'B747-400', B748: 'B747-8', B74F: 'B747-400F', B752: 'B757-200', B753: 'B757-300', B762: 'B767-200', B763: 'B767-300', B764: 'B767-400',
  B772: 'B777-200', B77L: 'B777-200LR', B773: 'B777-300', B77W: 'B777-300ER', B778: 'B777-8', B779: 'B777-9',
  B788: 'B787-8', B789: 'B787-9', B78X: 'B787-10',
  E170: 'E170', E175: 'E175', E190: 'E190', E195: 'E195', E290: 'E190-E2', E295: 'E195-E2',
  CRJ7: 'CRJ700', CRJ9: 'CRJ900', CRJX: 'CRJ1000', BCS1: 'A220-100', BCS3: 'A220-300',
  AT43: 'ATR42-300', AT45: 'ATR42-500', AT46: 'ATR42-600', AT72: 'ATR72', AT75: 'ATR72-500', AT76: 'ATR72-600',
  DH8A: 'DHC-8-100', DH8B: 'DHC-8-200', DH8C: 'DHC-8-300', DH8D: 'DHC-8-400', DHC6: 'DHC-6', SF34: 'SAAB340',
  MD11: 'MD-11', MD82: 'MD-82', MD90: 'MD-90', SU95: 'スホーイSSJ100', C208: 'セスナ208', BE20: 'キングエア200', PC12: 'PC-12'
};
