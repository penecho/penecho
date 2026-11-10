// Structural families, not a list of allowed nouns. JEV selects the semantic
// construction; the renderer owns dimensions, connections and symmetry.
export const FAMILIES = {
  classic: 'A directly matching existing visual form: cats, dogs, rabbits, bears, fish, birds, mountains, rivers, sun, planets, ball, human, humanoid robot, house, simple car or airplane. These already have detailed geometry; prefer classic for these exact objects.',
  vessel: 'A hollow container: pots, kettles, jugs, cups, bowls, vases, bottles. Body with optional opening, handle, spout, lid.',
  mechanism: 'A vehicle or machine with a chassis and articulated tools, wheels, tracks, rotors or boom. Construction machines, cranes, bikes, helicopters.',
  furniture: 'A supported platform or frame: chairs, desks, benches, beds, shelves, gates.',
  plant: 'A plant needing characteristic branching structure: cactus, palm, fern, bamboo, succulent.',
  animal: 'An animal not adequately described by an existing form: elephant, giraffe, dinosaur, insect, unusual creature. Anatomical proportions and appendages matter.',
  instrument: 'An elongated instrument on an optional stand: telescope, microscope, trumpet, lamp, camera, optical device.',
  radial: 'A hub with repeated radial elements: fan, windmill, turbine, umbrella, gear.',
  pendulum: 'A pendulum apparatus: fixed support, string or rod, suspended bob. 单摆、钟摆、摆球装置。',
  assembly: 'Other objects, assembled from a core and characteristic geometric appendages. Select when none of the above structures fit.',
};
const yesno = { yes: 'Present or intrinsic to this object / 存在', no: 'Absent, unnecessary, or explicitly removed / 没有' };
export const SPECS = {
  vessel: {
    body: { round: 'Round bulbous body', tall: 'Tall narrow necked body', straight: 'Straight cylindrical cup', wide: 'Wide shallow bowl' },
    handle: { none: 'No handle', one: 'One side loop handle', two: 'Two side handles', arch: 'An overhead arch handle' },
    spout: { none: 'No projecting spout. A normal cup or mug has only a circular rim and no spout.', short: 'A distinctly pinched projecting pouring lip, as on a jug', curved: 'Prominent upward curved pouring spout, as on a teapot' },
    lid: yesno, neck: { none: 'Wide body opening', short: 'Short narrowed neck', long: 'Tall narrow neck' },
    decoration: { plain: 'Plain surface', band: 'A contrasting stripe around the body', spots: 'Small decorative dots', fluted: 'Vertical ribs' },
  },
  mechanism: {
    base: { block: 'Solid elongated chassis', frame: 'Open tubular frame', hull: 'Rounded aerodynamic fuselage' },
    locomotion: { tracks: 'Two continuous crawler tracks', four_wheels: 'Four wheels', two_wheels: 'Two inline bicycle wheels', none: 'No wheels or tracks' },
    cabin: { enclosed: 'Enclosed operator cab with windows', seat: 'Exposed saddle or seat', none: 'No cabin or seat' },
    boom: { none: 'No arm or boom', articulated: 'Two connected bent lifting/digging arm segments', crane: 'Long diagonal lifting boom with hanging cable' },
    tool: { bucket: 'Concave digging bucket at arm endpoint', hook: 'Hook at cable endpoint', gripper: 'Two-finger gripper', fork: 'Two parallel fork tines', none: 'No end tool' },
    rotor: { none: 'No rotor', top: 'Horizontal overhead rotor and small tail rotor', front: 'Front propeller' },
    cargo: { none: 'No cargo container', bed: 'Open cargo bed', tank: 'Cylindrical tank' },
  },
  furniture: {
    platform: { square: 'Square platform', long: 'Long rectangular platform', round: 'Round top' },
    legs: { four: 'Four legs', pedestal: 'Single central pedestal', two: 'Two side supports', none: 'No legs' },
    back: { none: 'No backrest', low: 'Low backrest', tall: 'Tall backrest' },
    arms: yesno, shelves: { none: 'No stacked shelves', two: 'Two levels', four: 'Four levels' },
    soft: yesno,
  },
  plant: {
    stem: { thick: 'Thick succulent or cactus stem', woody: 'Woody tree trunk', thin: 'Thin green stem', segmented: 'Segmented bamboo stem' },
    branches: { none: 'Single unbranched stem', two: 'Two upward side branches', many: 'Several alternating branches', crown: 'Branches or fronds radiating at the top' },
    foliage: { none: 'No leaves. Cactus spines are NOT leaves; select none for a leafless cactus.', broad: 'Broad oval leaves', needle: 'Narrow leaves, excluding cactus spines', frond: 'Long palm or fern fronds', lobes: 'Rounded masses of foliage' },
    flowers: yesno, spines: yesno, pot: yesno,
  },
  animal: {
    posture: { quadruped: 'Horizontal body on four legs', upright: 'Upright seated body', elongated: 'Long low body', insect: 'Small body on six legs' },
    neck: { short: 'Short neck', long: 'Very long neck' },
    legs: { short: 'Short stout legs', long: 'Long thin legs', none: 'No legs' },
    ears: { none: 'No external ears', round: 'Small rounded ears', pointed: 'Pointed ears', large: 'Very large fan-shaped ears', long: 'Long narrow ears' },
    snout: { short: 'Short muzzle', long: 'Long muzzle', trunk: 'Long curved elephant-like trunk', beak: 'Pointed beak' },
    tail: { none: 'No tail', short: 'Short tail', long: 'Long curved tail', thick: 'Heavy tapering tail' },
    wings: yesno, horns: yesno,
    pattern: { plain: 'Plain surface', spots: 'Contrasting spots', stripes: 'Contrasting stripes', plates: 'Raised dorsal plates' },
  },
  instrument: {
    body: { tube: 'Long cylindrical tube', bell: 'Flared horn or bell', box: 'Box with front lens', dome: 'Domed shade' },
    direction: { horizontal: 'Horizontal', upward: 'Diagonal upward', downward: 'Diagonal downward', vertical: 'Vertical' },
    stand: { tripod: 'Three leg tripod', pedestal: 'One pedestal with circular foot', bent: 'Curved support arm and base', none: 'Handheld, no stand' },
    lens: { yes: 'Has an optical objective lens used to form an image', no: 'No optical objective lens. A light bulb or lampshade is not a lens.' },
    eyepiece: { yes: 'Has a small optical viewing tube for looking through with an eye', no: 'No eye viewing tube. Lamps do not have eyepieces.' },
    knobs: { yes: 'Has prominent adjustment knobs or tuning wheels', no: 'No prominent adjustment knobs' },
  },
  radial: {
    elements: { blades: 'Broad rotating blades', teeth: 'Small gear teeth', petals: 'Rounded petals', canopy: 'Continuous umbrella canopy' },
    count: { three: 'Three', four: 'Four', six: 'Six', eight: 'Eight' },
    stand: { short: 'Short desktop stand', tower: 'Tall tower', none: 'No stand' },
    axis: { front: 'The axle points horizontally; blades sweep a VERTICAL circle like a conventional wind turbine or table fan', up: 'The axle points upward; blades sweep a HORIZONTAL circle like a helicopter rotor or turntable' },
  },
  pendulum: { support: { frame: 'Two posts and overhead beam', single: 'One post and cantilever' }, bob: { sphere: 'Spherical weight', box: 'Block weight' }, string: { wire: 'Fine string', rod: 'Rigid rod' } },
  assembly: {
    core: { round: 'Round core', block: 'Block-like core', tall: 'Tall cylindrical core', flat: 'Broad flat core', ring: 'Open ring core' },
    upper: { none: 'Nothing above', sphere: 'Rounded head or cap above', cone: 'Pointed tip above', neck: 'Long narrow neck above', branches: 'Branches spreading above' },
    sides: { none: 'No side appendages', wings: 'Pair of wide flat wings', handles: 'Side loop handles', arms: 'Two jointed arms', lobes: 'Rounded side lobes' },
    lower: { none: 'No lower appendages', feet: 'Two feet', legs: 'Four legs', base: 'Broad supporting base', wheels: 'Four wheels' },
    front: { none: 'No front feature', eyes: 'Pair of eyes', opening: 'Circular opening', tube: 'Projecting tube', panel: 'Inset front panel' },
  },
};
export function blueprintQuestions(entities) {
  const questions = {};
  for (const e of entities) for (const [key, criteria] of Object.entries(SPECS[e.family] || {})) {
    questions[`${e.id}_b_${key}`] = { type: 'choice', instructions: `Design ONLY «${e.label}», not any other object. Select its ${key}. Follow explicit modifications; otherwise use its intrinsic real-world structure. All answers describe ONE coherent object.${key === 'soft' ? ' Does the furniture have upholstered cushions? Default no for a plain wooden chair or table.' : key === 'pot' ? ' Is a pot explicitly requested? Default no when unspecified.' : ''}`, criteria };
  }
  return questions;
}
export function blueprintFromAnswers(e, answers) {
  return { family: e.family, params: Object.fromEntries(Object.keys(SPECS[e.family] || {}).map((key) => [key, answers[`${e.id}_b_${key}`].choice])) };
}
