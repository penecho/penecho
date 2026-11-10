// This is a visual grammar, NOT an allowed-input vocabulary. Unseen nouns
// receive a compositional geometric abstraction, with their own original label.
export const FORMS = {
  planet: 'spherical planet, Earth, Mars, Jupiter / 地球、火星、木星、行星', satellite: 'spherical natural satellite, Moon in an astronomical orbital scene / 天文中的月球、卫星',
  sun: 'sun / 太阳', moon: 'moon / 月亮', star: 'star / 星星', cloud: 'cloud / 云',
  mountain: 'mountain, hill, volcano / 山、山峰、火山', river: 'river, stream / 河、小溪',
  lake: 'lake, sea, ocean, pond / 湖、海、池塘', rain: 'rain / 雨', snow: 'snow / 雪',
  tree: 'tree / 树', flower: 'flower / 花', grass: 'grass, meadow / 草、草地',
  mushroom: 'mushroom / 蘑菇', rock: 'rock, boulder / 石头', ground: 'ground, farmland, field, desert, beach / 地面、农田、田地、沙漠、沙滩',
  cat: 'cat, kitten / 猫、小猫', dog: 'dog, puppy / 狗', rabbit: 'rabbit / 兔子',
  bear: 'bear, panda / 熊、熊猫', fox: 'fox / 狐狸', pig: 'pig / 猪',
  horse: 'horse, deer, giraffe / 马、鹿、长颈鹿', bird: 'bird, chick / 鸟',
  duck: 'duck, goose / 鸭、鹅', penguin: 'penguin / 企鹅', fish: 'fish / 鱼',
  whale: 'whale, dolphin / 鲸、海豚', turtle: 'turtle / 乌龟', frog: 'frog / 青蛙',
  butterfly: 'butterfly / 蝴蝶', octopus: 'octopus / 章鱼', snail: 'snail / 蜗牛',
  person: 'human, person / 人', house: 'house, cottage / 房子', tower: 'tower, lighthouse / 塔、灯塔',
  castle: 'castle / 城堡', bridge: 'bridge / 桥', car: 'car, truck, bus, wheeled vehicle / 汽车、卡车',
  boat: 'boat, sailing ship / 船、帆船', airplane: 'airplane / 飞机', rocket: 'rocket / 火箭',
  robot: 'robot / 机器人', fruit: 'fruit, apple / 水果、苹果', carrot: 'carrot / 胡萝卜',
  bone: 'bone / 骨头', ball: 'ball / 球', heart: 'heart / 爱心',
  sphere: 'unlisted thing best abstracted as a round form / 未列出、以圆团抽象表达',
  box: 'unlisted thing best abstracted as blocks / 未列出、以方块抽象表达',
  cone: 'unlisted thing best abstracted as a pointed or triangular form / 尖锥形',
  cylinder: 'unlisted thing best abstracted as an upright column / 柱形',
  ribbon: 'unlisted thing best abstracted as a flowing curved ribbon / 曲线带状',
  ring: 'unlisted circular ring, wheel, donut / 环形',
  creature: 'unlisted creature, imaginary animal, dragon or monster / 未列出动物、龙、怪兽',
};
export const COLOR_SPACE = { natural: 'No explicit color; use natural palette / 未指定', orange: 'orange / 橙、橘', yellow: 'yellow, gold / 黄、金', red: 'red / 红', pink: 'pink / 粉', blue: 'blue / 蓝', green: 'green / 绿', purple: 'purple / 紫', white: 'white / 白', black: 'black / 黑', brown: 'brown / 棕', gray: 'gray, silver / 灰、银' };
export const MOTIONS = { still: 'No explicit motion / 没有明确运动', rise: 'rising, sunrise, going up / 升起、上升', fall: 'falling, descending, sunset / 落下、下降', flow: 'flowing continuously / 流淌', float: 'floating, drifting / 漂浮', spin: 'rotating, spinning / 旋转', orbit: 'orbiting around another object / 围绕运行', sway: 'swaying in wind / 随风摇摆', run: 'running, walking, driving / 跑、走、行驶', jump: 'jumping, bouncing / 跳跃', fly: 'flying, flapping / 飞翔', swim: 'swimming / 游动', eat: 'eating, nibbling / 吃东西', sleep: 'sleeping / 睡觉', dance: 'dancing / 跳舞', wave: 'waving / 挥手', grow: 'growing, blooming / 生长、开花' };
export const RELATIONS = { none: 'No specified relation / 未指定', above: 'above, over / 在上方', below: 'below, beneath / 在下方', left: 'to the left / 在左边', right: 'to the right / 在右边', behind: 'behind / 在后面', front: 'in front of / 在前面', on: 'on top of, resting on / 在上面', inside: 'inside, in water, in a place / 在里面', near: 'next to, near / 旁边、附近', eating: 'this entity eats the target / 此物吃目标', chasing: 'this entity chases the target / 此物追逐目标', orbiting: 'this entity orbits the target / 此物环绕目标', rising: 'this entity rises from behind the target / 此物从目标后方升起', crossing: 'crosses, spans across / 横跨目标' };
export const SHAPE_DETAILS = { plain: 'No extra distinctive appendages / 无特殊附肢', wings: 'Prominent wings / 翅膀', horns: 'Horns or antlers / 角', long_neck: 'Long neck / 长脖子', arms: 'Mechanical arms or branching appendages / 机械臂或分叉', spines: 'Spines or spikes / 尖刺', tail: 'A prominent long tail / 长尾巴', dome: 'Dome or cap / 圆顶' };
export const EMPTY_WORLD = { entities: [], mood: 'day', abstract: false };
export const MAX_ENTITIES = 8;
export const MAX_TEXT = 180;
