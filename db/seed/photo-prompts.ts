// O que pedir ao gerador de imagens por IA para cada produto do seed.
// O gerador entende melhor inglês, então cada nome de produto vira uma descrição
// em inglês do que deve aparecer na foto. A primeira regra que casa com o nome vale.

const FOOD = "professional food photography, appetizing, close-up, on a rustic wooden table, soft natural light, shallow depth of field, realistic, no text, no people";
const DRINK = "professional beverage photography, on a wooden table, soft natural light, condensation droplets, realistic, no text, no logo, no people";
const RAW = "professional food photography, fresh ingredients, on a clean kitchen counter, soft natural light, realistic, no text, no people";
const PACK = "professional product photography, plain unbranded packaging without any text or logo, on a clean light background, soft studio lighting, realistic, no people";

const lunchbox = (main: string) => `a Brazilian takeaway lunch box in an aluminum tray with white rice, beans, salad and ${main}`;
const lasagna = (kind: string, size: string) => `${size} ${kind}, golden melted cheese on top, in a baking dish`;
const sushi = (pieces: number) => `a sushi platter with ${pieces} assorted pieces, salmon nigiri, uramaki and hosomaki rolls, on a black slate board`;
const tub = "a large black tub of sports nutrition powder with a measuring scoop beside it";

const RULES: [RegExp, string, string][] = [
  // Descrições curtas e diretas para os produtos em que o gerador se perdia com as mais longas.
  [/barca de acai/, "an acai bowl with banana slices and granola, top view", FOOD],
  [/acai (300|500|700)/, "dark purple frozen acai in a clear plastic cup, topped with banana slices and granola", FOOD],
  [/combo pizza/, "a whole round pepperoni pizza, top view", FOOD],
  [/guioza/, "six fried gyoza dumplings in a row on a plate", FOOD],
  [/hot roll/, "sliced deep-fried sushi rolls on a plate", FOOD],
  [/temaki/, "a sushi hand roll", FOOD],
  [/picole/, "a strawberry popsicle", FOOD],
  [/sonho/, "a sugar-coated jam doughnut", FOOD],
  [/pao frances.*saco/, "a brown paper bag full of small crusty bread rolls", FOOD],
  [/pao frances/, "one small oval crusty bread roll, like a mini baguette", FOOD],
  [/kit cafe da manha/, "a breakfast table with bread rolls, sliced cheese and ham, papaya, a cup of coffee and orange juice", FOOD],
  [/batata 1 kg/, "raw brown potatoes in a wooden crate", RAW],
  [/carne moida/, "raw red minced beef on a white tray", RAW],
  [/frango inteiro/, "one whole raw plucked chicken on a white tray", RAW],
  [/coxa e sobrecoxa/, "raw chicken drumsticks on a white tray", RAW],
  [/linguica/, "brown smoked pork sausages on a wooden cutting board", RAW],
  [/agua mineral/, "a transparent plastic bottle of water with a blue cap", DRINK],
  [/antiacido/, "a glass of water with a white effervescent tablet dissolving and bubbling", PACK],
  [/dipirona|paracetamol/, "round white medicine tablets in a silver blister pack", PACK],
  [/escova de dentes/, "a toothbrush with white bristles lying on a table", PACK],
  [/fio dental/, "a small white dental floss dispenser with a piece of floss pulled out", PACK],
  [/termometro/, "a white digital medical thermometer with a small screen", PACK],
  [/curativo/, "beige adhesive bandage strips", PACK],
  [/sabao em barra/, "two blue bars of laundry soap", PACK],
  [/sabao em po/, "an open box of white washing powder with a measuring scoop", PACK],

  // Pizzaria
  [/combo pizza/, "a large pizza next to a 2 liter bottle of cola soda", FOOD],
  [/pizza broto/, "a small personal pizza with mozzarella, tomato sauce and oregano", FOOD],
  [/pizza media/, "a medium pizza, half pepperoni and half four cheese, top view", FOOD],
  [/pizza grande/, "a large pizza, half calabresa sausage with onions and half chicken with cream cheese, top view", FOOD],
  [/pizza familia/, "a very large family size pizza with assorted toppings, sliced, top view", FOOD],
  [/esfiha de carne/, "three open-faced meat pies (sfiha) with seasoned ground beef on a plate", FOOD],
  [/esfiha de queijo/, "three open-faced cheese pies (sfiha) with melted white cheese on a plate", FOOD],
  [/pao de alho/, "four pieces of grilled garlic bread with melted cheese", FOOD],
  [/pudim/, "a slice of Brazilian caramel flan with caramel sauce on a white plate", FOOD],
  [/doce de leite/, "a square slice of dulce de leche fudge on a small plate", FOOD],

  // Lasanhas
  [/lasanha bolonhesa familia/, lasagna("lasagna bolognese", "a large family-size"), FOOD],
  [/lasanha bolonhesa/, lasagna("lasagna bolognese", "an individual portion of"), FOOD],
  [/lasanha carne de sol familia/, lasagna("lasagna with shredded dried beef", "a large family-size"), FOOD],
  [/lasanha carne de sol/, lasagna("lasagna with shredded dried beef", "an individual portion of"), FOOD],
  [/lasanha frango.*familia/, lasagna("chicken lasagna with creamy white sauce", "a large family-size"), FOOD],
  [/lasanha frango/, lasagna("chicken lasagna with creamy white sauce", "an individual portion of"), FOOD],
  [/lasanha quatro queijos familia/, lasagna("four cheese lasagna", "a large family-size"), FOOD],
  [/lasanha quatro queijos/, lasagna("four cheese lasagna", "an individual portion of"), FOOD],
  [/salada de alface/, "a fresh lettuce and tomato salad in a bowl", FOOD],

  // Quentinhas
  [/quentinha de carne de sol/, lunchbox("sun-dried beef with sauteed onions"), FOOD],
  [/quentinha de churrasco/, lunchbox("mixed grilled barbecue meats"), FOOD],
  [/quentinha de feijoada/, lunchbox("black bean and pork stew"), FOOD],
  [/quentinha de frango/, lunchbox("stewed chicken pieces in sauce"), FOOD],
  [/quentinha de galinha/, lunchbox("free-range chicken stew"), FOOD],
  [/quentinha de peixe/, lunchbox("a fried fish fillet"), FOOD],
  [/marmita fitness/, "a healthy meal prep container with grilled chicken breast, brown rice and steamed broccoli and carrots", FOOD],
  [/salada de frutas/, "a clear cup of fresh fruit salad with mango, papaya, banana and grapes", FOOD],

  // Sushi
  [/combo 15/, sushi(15), FOOD],
  [/combo 30/, sushi(30), FOOD],
  [/combo 50/, sushi(50), FOOD],
  [/guioza/, "six pan-fried gyoza dumplings with a small bowl of soy dipping sauce", FOOD],
  [/harumaki/, "four crispy golden spring rolls with sweet chili sauce", FOOD],
  [/hot roll/, "ten deep-fried crispy sushi rolls drizzled with teriyaki sauce", FOOD],
  [/sashimi/, "ten slices of fresh salmon sashimi on a plate with wasabi and ginger", FOOD],
  [/sunomono/, "Japanese cucumber salad with sesame seeds in a small ceramic bowl", FOOD],
  [/temaki/, "a salmon temaki hand roll cone with rice and nori", FOOD],
  [/yakisoba/, "chicken yakisoba noodles with vegetables in a bowl, with chopsticks", FOOD],
  [/cha gelado/, "a tall glass of iced tea with lemon slices and ice cubes", DRINK],

  // Peixaria
  [/caldo de peixe/, "a bowl of fish broth soup with cilantro and lime", FOOD],
  [/camarao empanado/, "a portion of breaded fried shrimp with lemon wedges", FOOD],
  [/camarao limpo/, "a tray of raw peeled shrimp on crushed ice", RAW],
  [/file de tilapia/, "raw white tilapia fillets on a tray with ice", RAW],
  [/isca de peixe/, "fried breaded fish strips with lemon wedges and tartar sauce", FOOD],
  [/peixe frito/, "a whole fried fish on a plate with lemon and vinaigrette salad", FOOD],
  [/pirao/, "a bowl of thick Brazilian fish gravy porridge with cilantro", FOOD],
  [/postas de cavala/, "raw mackerel fish steaks on a tray with crushed ice", RAW],
  [/sardinha/, "fresh raw sardines on a tray with crushed ice", RAW],
  [/tilapia inteira/, "a whole fresh raw tilapia fish on crushed ice", RAW],

  // Hambúrgueres e lanches
  [/brasa bacon/, "a gourmet bacon cheeseburger with a brioche bun, melted cheddar and crispy bacon", FOOD],
  [/brasa classico/, "a classic cheeseburger with lettuce, tomato and a sesame bun", FOOD],
  [/brasa duplo/, "a double patty cheeseburger with melted cheese, tall and juicy", FOOD],
  [/brasa nordestino/, "a gourmet burger with grilled white cheese slab and caramelized onions", FOOD],
  [/frango crispy/, "a crispy fried chicken burger with lettuce and mayonnaise", FOOD],
  [/veggie/, "a veggie burger with a plant-based patty, avocado and fresh vegetables", FOOD],
  [/x-salada/, "a simple cheeseburger with lettuce and tomato on a paper wrap, snack bar style", FOOD],
  [/misto quente/, "a grilled ham and cheese sandwich cut in half with melted cheese", FOOD],
  [/batata com cheddar/, "french fries topped with melted cheddar sauce and bacon bits", FOOD],
  [/batata frita/, "a portion of golden crispy french fries in a paper cone", FOOD],
  [/aneis de cebola/, "a portion of crispy golden onion rings", FOOD],
  [/espetinho de carne/, "grilled beef skewers on a plate", FOOD],
  [/espetinho de frango/, "grilled chicken skewers on a plate", FOOD],
  [/espetinho de queijo/, "grilled white cheese skewers on a plate", FOOD],

  // Açaí e sobremesas
  [/barca de acai/, "a large boat-shaped tray of acai berry sorbet topped with strawberries, banana, granola and condensed milk", FOOD],
  [/milkshake de acai/, "a purple acai berry milkshake with whipped cream in a tall glass", DRINK],
  [/acai 300/, "a small clear cup of purple acai berry sorbet topped with banana slices and granola", FOOD],
  [/acai 500/, "a medium clear cup of purple acai berry sorbet topped with banana, granola and powdered milk", FOOD],
  [/acai 700/, "a large clear cup of purple acai berry sorbet topped with strawberries, banana and granola", FOOD],
  [/creme de cupuacu/, "a cup of creamy white tropical fruit mousse dessert", FOOD],
  [/suco de cupuacu/, "a glass of creamy white tropical fruit juice with ice", DRINK],
  [/picole/, "a colorful fruit popsicle on a stick", FOOD],
  [/taca de sorvete/, "an ice cream sundae glass with two scoops, chocolate syrup and a wafer", FOOD],
  [/milkshake/, "a chocolate milkshake with whipped cream in a tall glass with a straw", DRINK],
  [/bolo de chocolate/, "a slice of moist chocolate cake with chocolate frosting on a plate", FOOD],
  [/bolo de cenoura/, "a slice of Brazilian carrot cake with chocolate glaze on a plate", FOOD],
  [/bolo de milho/, "a slice of yellow corn cake on a plate", FOOD],
  [/bolo (no|de) pote/, "cake in a glass jar with layers of sponge, cream and chocolate, with a spoon", FOOD],
  [/fatia de bolo/, "a slice of layered vanilla cake with frosting on a plate", FOOD],
  [/sonho/, "a cream-filled doughnut dusted with powdered sugar", FOOD],

  // Salgados e doces de festa
  [/cento de salgadinhos/, "a big tray with a hundred assorted Brazilian party snacks, small fried croquettes and cheese balls", FOOD],
  [/cento de brigadeiro/, "a tray full of Brazilian chocolate truffles covered in chocolate sprinkles in small paper cups", FOOD],
  [/coxinha/, "Brazilian coxinha, golden teardrop-shaped fried chicken croquettes on a plate", FOOD],
  [/bolinha de queijo/, "golden fried cheese balls on a plate, one cut open with melted cheese", FOOD],
  [/empada/, "a small golden Brazilian chicken pot pie", FOOD],
  [/enroladinho/, "golden sausage rolls in baked pastry on a plate", FOOD],
  [/pastel de carne/, "a crispy rectangular Brazilian fried pastry filled with ground beef, one cut open", FOOD],
  [/pastel de frango/, "a crispy rectangular Brazilian fried pastry filled with shredded chicken and cream cheese, one cut open", FOOD],
  [/pastel de queijo/, "a crispy rectangular Brazilian fried pastry filled with melted cheese, one cut open", FOOD],
  [/pastel/, "crispy rectangular Brazilian fried pastries on a plate", FOOD],
  [/risole/, "half-moon shaped breaded fried croquettes on a plate", FOOD],
  [/torta de frango/, "a slice of savory chicken pie with a golden crust", FOOD],
  [/caldo de cana/, "a glass of fresh green sugarcane juice with ice", DRINK],

  // Padaria e café da manhã
  [/cuscuz com charque/, "a mound of yellow steamed cornmeal couscous topped with shredded dried beef, Brazilian northeastern breakfast", FOOD],
  [/cuscuz com ovo/, "a mound of yellow steamed cornmeal couscous with a fried egg on top, Brazilian northeastern breakfast", FOOD],
  [/tapioca/, "a white Brazilian tapioca crepe folded in half, filled with melted cheese", FOOD],
  [/cafe com leite/, "a cup of coffee with milk on a saucer", DRINK],
  [/kit cafe da manha/, "a breakfast spread for two with bread rolls, cheese, ham, fruit, coffee and orange juice", FOOD],
  [/pao de queijo/, "six small golden Brazilian cheese breads in a basket", FOOD],
  [/pao doce/, "a sweet bread roll with sugar glaze and coconut", FOOD],
  [/pao frances.*saco/, "a brown paper bag full of crusty french bread rolls", FOOD],
  [/pao frances/, "a single crusty golden french bread roll", FOOD],
  [/pao de forma/, "a loaf of sliced sandwich bread", PACK],

  // Bebidas
  [/refrigerante 2 l/, "a 2 liter plastic bottle of dark cola soda", DRINK],
  [/refrigerante lata/, "a cold aluminum soda can", DRINK],
  [/agua de coco/, "a glass of coconut water next to a green coconut", DRINK],
  [/agua mineral/, "a clear plastic bottle of mineral water", DRINK],
  [/suco de caixa/, "a juice carton next to a glass of fruit juice", DRINK],
  [/suco em po/, "a small sachet of powdered drink mix next to a glass of juice", PACK],
  [/suco/, "a glass of fresh orange juice with ice and a slice of orange", DRINK],
  [/caixa com 12 latas/, "a cardboard pack of twelve beer cans", DRINK],
  [/cerveja long neck/, "a cold long neck beer bottle", DRINK],
  [/cerveja/, "a cold beer can next to a glass of golden beer with foam", DRINK],
  [/energetico/, "a slim energy drink can", DRINK],
  [/gelo/, "a clear plastic bag full of ice cubes", PACK],
  [/carvao/, "a paper bag of barbecue charcoal with some charcoal pieces beside it", PACK],
  [/copos descartaveis/, "a stack of white disposable plastic cups", PACK],
  [/amendoim torrado/, "a bowl of roasted salted peanuts", FOOD],

  // Empório natural
  [/aveia/, "a bowl of rolled oats with a wooden spoon", RAW],
  [/acucar mascavo/, "a bowl of brown sugar", RAW],
  [/castanha de caju/, "a bowl of roasted cashew nuts", RAW],
  [/cha de camomila/, "dried chamomile flowers in a bowl next to a cup of tea", RAW],
  [/cha de erva-doce/, "fennel seeds in a bowl next to a cup of herbal tea", RAW],
  [/farinha de linhaca/, "a bowl of ground flaxseed meal", RAW],
  [/granola/, "a glass jar of crunchy granola", RAW],
  [/mel /, "a glass jar of golden honey with a wooden honey dipper", RAW],
  [/mix de castanhas/, "a bowl of mixed nuts, almonds, cashews and brazil nuts", RAW],
  [/pasta de amendoim/, "an open jar of peanut butter with a spoon", RAW],
  [/quinoa/, "a bowl of raw quinoa grains", RAW],
  [/oleo de coco/, "a glass jar of white coconut oil next to a halved coconut", RAW],

  // Suplementos
  [/whey|albumina|creatina|glutamina|pre-treino/, tub, PACK],
  [/bcaa|multivitaminico/, "a white supplement bottle with capsules spilled beside it", PACK],
  [/barra de cereal/, "a box of cereal bars with some bars outside", PACK],
  [/barra de proteina/, "a chocolate protein bar partially unwrapped", PACK],
  [/coqueteleira/, "a plastic protein shaker bottle", PACK],
  [/garrafa de agua/, "a reusable sports water bottle", PACK],

  // Farmácia e higiene
  [/absorvente/, "a pack of sanitary pads", PACK],
  [/antiacido/, "two sachets of effervescent antacid next to a glass of fizzy water", PACK],
  [/curativo/, "a box of adhesive bandages with a few bandages outside", PACK],
  [/dipirona|paracetamol/, "a blister pack of white pills next to a plain white medicine box", PACK],
  [/escova de dentes/, "a toothbrush", PACK],
  [/fio dental/, "a dental floss container", PACK],
  [/fralda/, "a pack of baby diapers", PACK],
  [/preservativo/, "a small plain box, pharmacy product", PACK],
  [/protetor solar/, "a tube of sunscreen lotion", PACK],
  [/repelente/, "a spray bottle of insect repellent", PACK],
  [/sais de reidratacao/, "a sachet of oral rehydration salts next to a glass of water", PACK],
  [/soro fisiologico/, "a plastic bottle of saline solution", PACK],
  [/termometro/, "a digital thermometer", PACK],
  [/alcool/, "a clear bottle of rubbing alcohol", PACK],
  [/algodao/, "a bag of white cotton balls", PACK],
  [/cotonete/, "a box of cotton swabs", PACK],
  [/creme dental/, "a tube of toothpaste next to its box", PACK],
  [/desodorante/, "an aerosol deodorant can", PACK],
  [/condicionador|xampu/, "a bottle of shampoo", PACK],
  [/sabonete/, "a bar of soap on a soap dish", PACK],
  [/papel higienico/, "a pack of four toilet paper rolls", PACK],

  // Limpeza
  [/amaciante/, "a large bottle of blue fabric softener", PACK],
  [/desinfetante/, "a bottle of floor cleaner disinfectant", PACK],
  [/detergente/, "a bottle of yellow dish soap", PACK],
  [/esponja de aco/, "steel wool scouring pads", PACK],
  [/sabao em barra/, "bars of laundry soap", PACK],
  [/sabao em po/, "a box of laundry detergent powder with a scoop", PACK],
  [/agua sanitaria/, "a white bottle of bleach", PACK],

  // Mercearia
  [/achocolatado/, "a can of chocolate milk powder next to a glass of chocolate milk", PACK],
  [/arroz/, "a bag of white rice next to a bowl of rice grains", PACK],
  [/acucar/, "a bag of white sugar next to a bowl of sugar", PACK],
  [/biscoito cream cracker/, "a pack of cream crackers with crackers on a plate", PACK],
  [/bolacha doce/, "a pack of sweet cookies with cookies on a plate", PACK],
  [/cafe torrado/, "a bag of roasted ground coffee next to a cup of coffee", PACK],
  [/farinha de mandioca/, "a bowl of coarse yellow cassava flour", RAW],
  [/farinha de trigo/, "a bag of wheat flour next to a bowl of flour", PACK],
  [/feijao/, "a bag of pinto beans next to a bowl of beans", PACK],
  [/flocao de milho/, "a pack of yellow cornmeal flakes next to a bowl of cornmeal", PACK],
  [/leite em po/, "a can of powdered milk with a scoop", PACK],
  [/macarrao/, "a pack of dry spaghetti pasta", PACK],
  [/molho de tomate/, "a pouch of tomato sauce next to a bowl of tomato sauce", PACK],
  [/oleo de soja/, "a bottle of golden cooking oil", PACK],
  [/sal refinado/, "a bag of salt next to a small bowl of salt", PACK],
  [/torrada/, "a pack of toasts with toasts on a plate", PACK],

  // Laticínios, carnes e hortifrúti
  [/iogurte/, "a cup of plain yogurt with a spoon", RAW],
  [/leite integral/, "a carton of milk next to a glass of milk", PACK],
  [/manteiga/, "a block of butter on a butter dish", RAW],
  [/queijo coalho/, "a block of firm white cheese, partly sliced, on a board", RAW],
  [/requeijao/, "a glass jar of creamy cheese spread with a knife", RAW],
  [/ovos/, "a carton of a dozen brown eggs", RAW],
  [/carne moida/, "a tray of fresh raw ground beef", RAW],
  [/charque/, "a tray of salted dried beef pieces", RAW],
  [/coxa e sobrecoxa/, "a tray of raw chicken thighs and drumsticks", RAW],
  [/frango inteiro/, "a whole raw chicken on a tray", RAW],
  [/linguica/, "smoked sausage links on a wooden board", RAW],
  [/alface/, "a fresh head of green lettuce", RAW],
  [/banana/, "a bunch of ripe yellow bananas", RAW],
  [/batata/, "fresh potatoes in a basket", RAW],
  [/cebola/, "fresh onions in a basket", RAW],
  [/cenoura/, "fresh carrots with green tops", RAW],
  [/coentro/, "a bunch of fresh cilantro", RAW],
  [/limao/, "fresh green limes, one cut in half", RAW],
  [/mamao/, "a ripe papaya cut in half showing the seeds", RAW],
  [/tomate/, "fresh ripe red tomatoes", RAW],
];

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A descrição em inglês da foto de um produto, para o gerador de imagens. */
export function photoPrompt(productName: string): string {
  const name = `${plain(productName)} `;
  const rule = RULES.find(([pattern]) => pattern.test(name));
  return rule ? `${rule[1]}, ${rule[2]}` : `${productName}, Brazilian grocery product, ${PACK}`;
}

/** Verdadeiro quando o produto tem uma descrição própria (e não a genérica). */
export const hasOwnPrompt = (productName: string) => RULES.some(([pattern]) => pattern.test(`${plain(productName)} `));

/**
 * Produtos que o gerador gratuito não consegue desenhar direito (saem irreconhecíveis).
 * Ficam com o desenho do projeto, que é melhor do que uma foto errada.
 */
export const keepsDrawing = (productName: string) => /picole|escova de dentes/.test(plain(productName));
