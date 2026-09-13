/**
 * 日本の主要空港。lat/lon は空港参照点、radiusNm は「空港内」とみなす半径（海里）。
 * 順序は UI のプルダウンにそのまま使う。
 */
export const AIRPORTS = [
  { icao: 'RJTT', iata: 'HND', name: '東京国際（羽田）', lat: 35.5523, lon: 139.7798, radiusNm: 3.0 },
  { icao: 'RJAA', iata: 'NRT', name: '成田国際', lat: 35.7647, lon: 140.3864, radiusNm: 3.0 },
  { icao: 'RJBB', iata: 'KIX', name: '関西国際', lat: 34.4347, lon: 135.2441, radiusNm: 2.5 },
  { icao: 'RJOO', iata: 'ITM', name: '大阪国際（伊丹）', lat: 34.7855, lon: 135.4382, radiusNm: 1.8 },
  { icao: 'RJBE', iata: 'UKB', name: '神戸', lat: 34.6328, lon: 135.2239, radiusNm: 1.5 },
  { icao: 'RJGG', iata: 'NGO', name: '中部国際（セントレア）', lat: 34.8584, lon: 136.8054, radiusNm: 2.5 },
  { icao: 'RJNA', iata: 'NKM', name: '名古屋（小牧）', lat: 35.2550, lon: 136.9244, radiusNm: 1.5 },
  { icao: 'RJCC', iata: 'CTS', name: '新千歳', lat: 42.7752, lon: 141.6923, radiusNm: 2.5 },
  { icao: 'RJFF', iata: 'FUK', name: '福岡', lat: 33.5859, lon: 130.4510, radiusNm: 1.8 },
  { icao: 'ROAH', iata: 'OKA', name: '那覇', lat: 26.1958, lon: 127.6460, radiusNm: 2.0 },
  { icao: 'RJFK', iata: 'KOJ', name: '鹿児島', lat: 31.8034, lon: 130.7194, radiusNm: 1.5 },
  { icao: 'RJFT', iata: 'KMJ', name: '熊本（阿蘇くまもと）', lat: 32.8373, lon: 130.8550, radiusNm: 1.5 },
  { icao: 'RJFM', iata: 'KMI', name: '宮崎', lat: 31.8772, lon: 131.4486, radiusNm: 1.5 },
  { icao: 'RJFU', iata: 'NGS', name: '長崎', lat: 32.9169, lon: 129.9136, radiusNm: 1.5 },
  { icao: 'RJFO', iata: 'OIT', name: '大分', lat: 33.4794, lon: 131.7372, radiusNm: 1.5 },
  { icao: 'RJFR', iata: 'KKJ', name: '北九州', lat: 33.8459, lon: 131.0349, radiusNm: 1.5 },
  { icao: 'RJFS', iata: 'HSG', name: '佐賀（九州佐賀国際）', lat: 33.1497, lon: 130.3022, radiusNm: 1.5 },
  { icao: 'RJOA', iata: 'HIJ', name: '広島', lat: 34.4361, lon: 132.9194, radiusNm: 1.5 },
  { icao: 'RJOB', iata: 'OKJ', name: '岡山（岡山桃太郎）', lat: 34.7569, lon: 133.8553, radiusNm: 1.5 },
  { icao: 'RJOM', iata: 'MYJ', name: '松山', lat: 33.8272, lon: 132.6997, radiusNm: 1.5 },
  { icao: 'RJOT', iata: 'TAK', name: '高松', lat: 34.2142, lon: 134.0156, radiusNm: 1.5 },
  { icao: 'RJOK', iata: 'KCZ', name: '高知（高知龍馬）', lat: 33.5461, lon: 133.6694, radiusNm: 1.5 },
  { icao: 'RJOS', iata: 'TKS', name: '徳島（徳島阿波おどり）', lat: 34.1328, lon: 134.6067, radiusNm: 1.5 },
  { icao: 'RJOH', iata: 'YGJ', name: '米子（米子鬼太郎）', lat: 35.4922, lon: 133.2364, radiusNm: 1.5 },
  { icao: 'RJOI', iata: 'IWK', name: '岩国（岩国錦帯橋）', lat: 34.1439, lon: 132.2356, radiusNm: 1.5 },
  { icao: 'RJDC', iata: 'UBJ', name: '山口宇部', lat: 33.9300, lon: 131.2789, radiusNm: 1.5 },
  { icao: 'RJSS', iata: 'SDJ', name: '仙台', lat: 38.1397, lon: 140.9169, radiusNm: 1.8 },
  { icao: 'RJSN', iata: 'KIJ', name: '新潟', lat: 37.9559, lon: 139.1206, radiusNm: 1.5 },
  { icao: 'RJNK', iata: 'KMQ', name: '小松', lat: 36.3946, lon: 136.4075, radiusNm: 1.5 },
  { icao: 'RJNT', iata: 'TOY', name: '富山（富山きときと）', lat: 36.6483, lon: 137.1875, radiusNm: 1.5 },
  { icao: 'RJNS', iata: 'FSZ', name: '静岡（富士山静岡）', lat: 34.7961, lon: 138.1894, radiusNm: 1.5 },
  { icao: 'RJAH', iata: 'IBR', name: '茨城', lat: 36.1811, lon: 140.4147, radiusNm: 1.5 },
  { icao: 'RJSA', iata: 'AOJ', name: '青森', lat: 40.7347, lon: 140.6908, radiusNm: 1.5 },
  { icao: 'RJSK', iata: 'AXT', name: '秋田', lat: 39.6156, lon: 140.2186, radiusNm: 1.5 },
  { icao: 'RJSI', iata: 'HNA', name: '花巻（いわて花巻）', lat: 39.4286, lon: 141.1353, radiusNm: 1.5 },
  { icao: 'RJSC', iata: 'GAJ', name: '山形', lat: 38.4119, lon: 140.3711, radiusNm: 1.5 },
  { icao: 'RJSF', iata: 'FKS', name: '福島', lat: 37.2274, lon: 140.4311, radiusNm: 1.5 },
  { icao: 'RJCH', iata: 'HKD', name: '函館', lat: 41.7700, lon: 140.8219, radiusNm: 1.5 },
  { icao: 'RJEC', iata: 'AKJ', name: '旭川', lat: 43.6708, lon: 142.4475, radiusNm: 1.5 },
  { icao: 'RJCB', iata: 'OBO', name: '帯広（とかち帯広）', lat: 42.7333, lon: 143.2172, radiusNm: 1.5 },
  { icao: 'RJCK', iata: 'KUH', name: '釧路（たんちょう釧路）', lat: 43.0410, lon: 144.1930, radiusNm: 1.5 },
  { icao: 'RJCM', iata: 'MMB', name: '女満別', lat: 43.8806, lon: 144.1642, radiusNm: 1.5 },
  { icao: 'RJKA', iata: 'ASJ', name: '奄美', lat: 28.4306, lon: 129.7125, radiusNm: 1.5 },
  { icao: 'ROIG', iata: 'ISG', name: '新石垣', lat: 24.3964, lon: 124.2450, radiusNm: 1.5 },
  { icao: 'ROMY', iata: 'MMY', name: '宮古', lat: 24.7828, lon: 125.2950, radiusNm: 1.5 }
];

export function findAirport(icao) {
  for (var i = 0; i < AIRPORTS.length; i++) {
    if (AIRPORTS[i].icao === icao) return AIRPORTS[i];
  }
  return null;
}
