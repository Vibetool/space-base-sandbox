// 模块目录:每个可放置件的元数据
// type: 'cell'   → 按格放置(地板/房间/走廊/装饰/道路)
//       'edge'   → 放在格子边线上(墙)
//       'door'   → 放在边线上且磁吸建筑、可替换墙(门)
//       'vertex' → 放在格点上(角柱)
// layer: 'ground' | 'struct'(cell 类型的占用层)
export const CELL = 4; // 基础网格 4 米(Space Kit 原生尺寸)

// 用 Vite BASE_URL 前缀,兼容子路径部署(如 GitHub Pages /space-base-sandbox/)
const BASE = import.meta.env.BASE_URL;
const SK = (file) => `${BASE}models/${file}.glb`;
const RD = (n) => `${BASE}models/roads/roadTile_${String(n).padStart(3, '0')}.gltf`;

export const CATEGORIES = [
  { id: 'floor', name: '地板' },
  { id: 'wall', name: '墙体' },
  { id: 'door', name: '门' },
  { id: 'room', name: '房间' },
  { id: 'corridor', name: '走廊' },
  { id: 'prop', name: '装饰' },
  { id: 'road', name: '道路' },
];

export const CATALOG = {};
function def(id, name, cat, type, url, extra = {}) {
  CATALOG[id] = { id, name, cat, type, url, layer: 'struct', ...extra };
}

// ── 地板(地面层)──
def('template-floor', '基础地板', 'floor', 'cell', SK('template-floor'), { layer: 'ground' });
def('template-floor-detail', '格纹地板', 'floor', 'cell', SK('template-floor-detail'), { layer: 'ground' });
def('template-floor-detail-a', '拼花地板', 'floor', 'cell', SK('template-floor-detail-a'), { layer: 'ground' });
def('template-floor-big', '大块地板', 'floor', 'cell', SK('template-floor-big'), { layer: 'ground' });
def('template-floor-layer', '低台', 'floor', 'cell', SK('template-floor-layer'));
def('template-floor-layer-raised', '高台', 'floor', 'cell', SK('template-floor-layer-raised'));
def('template-floor-layer-hole', '高台-镂空', 'floor', 'cell', SK('template-floor-layer-hole'));

// ── 墙体(边线层)──
def('template-wall', '标准墙', 'wall', 'edge', SK('template-wall'));
def('template-wall-detail-a', '管线墙', 'wall', 'edge', SK('template-wall-detail-a'));
def('template-wall-top', '高顶墙', 'wall', 'edge', SK('template-wall-top'));
def('template-wall-stairs', '梯侧墙', 'wall', 'edge', SK('template-wall-stairs'));
def('template-wall-half', '半段墙', 'wall', 'edge', SK('template-wall-half'));
def('template-wall-corner', '墙角柱', 'wall', 'vertex', SK('template-wall-corner'));
def('template-corner', '圆角墙块', 'wall', 'cell', SK('template-corner'));

// ── 门(边线层,磁吸建筑/替换墙)──
def('gate-door', '滑动门', 'door', 'door', SK('gate-door'), { animDoor: true });
def('gate-door-window', '舷窗门', 'door', 'door', SK('gate-door-window'), { animDoor: true });
def('gate', '通道门框', 'door', 'door', SK('gate'));
def('gate-lasers', '激光闸门', 'door', 'door', SK('gate-lasers'));

// ── 房间(结构层,多格)──
def('room-small', '小型舱室', 'room', 'cell', SK('room-small'));
def('room-small-variation', '小型舱室B', 'room', 'cell', SK('room-small-variation'));
def('room-corner', '转角舱室', 'room', 'cell', SK('room-corner'));
def('room-wide', '宽型舱室', 'room', 'cell', SK('room-wide'));
def('room-wide-variation', '宽型舱室B', 'room', 'cell', SK('room-wide-variation'));
def('room-large', '大型舱室', 'room', 'cell', SK('room-large'));
def('room-large-variation', '大型舱室B', 'room', 'cell', SK('room-large-variation'));

// ── 走廊(结构层)──
def('corridor', '走廊', 'corridor', 'cell', SK('corridor'));
def('corridor-corner', '走廊转角', 'corridor', 'cell', SK('corridor-corner'));
def('corridor-end', '走廊尽头', 'corridor', 'cell', SK('corridor-end'));
def('corridor-intersection', '十字路口', 'corridor', 'cell', SK('corridor-intersection'));
def('corridor-junction', '丁字路口', 'corridor', 'cell', SK('corridor-junction'));
def('corridor-transition', '宽窄过渡', 'corridor', 'cell', SK('corridor-transition'));
def('corridor-wide', '宽走廊', 'corridor', 'cell', SK('corridor-wide'));
def('corridor-wide-corner', '宽廊转角', 'corridor', 'cell', SK('corridor-wide-corner'));
def('corridor-wide-end', '宽廊尽头', 'corridor', 'cell', SK('corridor-wide-end'));
def('corridor-wide-intersection', '宽廊十字', 'corridor', 'cell', SK('corridor-wide-intersection'));
def('corridor-wide-junction', '宽廊丁字', 'corridor', 'cell', SK('corridor-wide-junction'));

// ── 装饰(结构层)──
def('stairs', '楼梯', 'prop', 'cell', SK('stairs'));
def('stairs-wide', '宽楼梯', 'prop', 'cell', SK('stairs-wide'));
def('template-detail', '立柱', 'prop', 'cell', SK('template-detail'));
def('cables', '电缆', 'prop', 'cell', SK('cables'));

// ── 道路(地面层,302 块,缩放 4/3 适配网格)──
// 按形状分成 5 个子分类,方便浏览
export const ROAD_SUBS = [
  { id: 'street', name: '街道' },
  { id: 'highway', name: '公路' },
  { id: 'junction', name: '路口' },
  { id: 'water', name: '水域' },
  { id: 'terrain', name: '地形' },
];
// 全部 302 块按形状归入 5 个子分类展示
const R = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ROAD_SUB_SETS = {
  water: new Set([1, 42, 81, 145, 146, 167, 168, ...R(171, 180), ...R(185, 190), 195, 196,
    205, 206, 215, 216, 233, 234, 235, ...R(241, 244), 251, 252, 253, 265, 272, 282, 283, 284]),
  junction: new Set([25, 75, 87, 88, 92, 93, 95, 96, 109, 137, 138, 141, 142, 166, 194,
    210, 260, 266, 277, 278, 279, 287, 288]),
  terrain: new Set([...R(2, 24), 28, 29, ...R(36, 39), 52, 140, 144, ...R(147, 160), 163, 169, 170, 263]),
  street: new Set([26, 27, ...R(30, 35), 40, 41, ...R(43, 51), ...R(53, 74), ...R(76, 80),
    ...R(82, 86), ...R(89, 91), ...R(110, 136), 139, 161, 162, 164, 165, ...R(181, 184)]),
};
function roadSub(n) {
  for (const k of ['water', 'junction', 'terrain', 'street']) if (ROAD_SUB_SETS[k].has(n)) return k;
  return 'highway'; // 其余:公路/匝道
}

export const ROAD_SCALE = CELL / 3; // 道路瓦片原生 3m
for (let n = 1; n <= 302; n++) {
  const id = `road-${String(n).padStart(3, '0')}`;
  def(id, `道路 ${n}`, 'road', 'cell', RD(n), { layer: 'ground', scale: ROAD_SCALE, sub: roadSub(n) });
}
