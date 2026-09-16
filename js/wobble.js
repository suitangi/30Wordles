// Wobble — Day 3 variant of 30 Wordles.
// A staggered-guess Wordle: probes are 4 letters and only see a 4-column
// window of the answer — odd probes read columns 1-4, even probes read
// columns 2-5, alternating per probe played (commits don't move the
// window). Commits are 5 letters, see the whole word, and are the only
// guesses that can win. Eight turns; the eighth is commit-only.
//
// The daily answer derives from the date (salted "wobble"); progress is
// saved to localStorage and resumes on refresh. Practice plays random
// words without touching the daily save.
(function () {
  "use strict";

  var COLS = 5;
  var PROBE_LEN = 4;
  var TURNS = 8;
  var ODD = [0, 1, 2, 3];  // columns 1-4
  var EVEN = [1, 2, 3, 4]; // columns 2-5
  var PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid",
    "Great", "Phew", "Phew", "Got there"];
  var FLIP_STAGGER = 240; // ms between tile flips
  var FLIP_MID = 250;     // half-turn point: the mark color appears here
  var SALT = "wobble";
  var STORE_KEY = "wobble-day3";
  var GAME_URL = "https://suitangi.github.io/30Wordles/days/3";

  var PROBE_WORDS = [
    "aahs", "aals", "abas", "abba", "abbe", "abed", "abet", "able", "ably", "abri", "abut", "abye",
    "abys", "acai", "aced", "acer", "aces", "ache", "achy", "acid", "acme", "acne", "acre", "acro",
    "acta", "acts", "acyl", "adam", "adds", "adit", "ados", "adsl", "adze", "aeon", "aero", "aery",
    "afar", "afro", "agar", "agas", "aged", "agee", "ager", "ages", "agha", "agin", "agio", "aglu",
    "agly", "agma", "agog", "agon", "agro", "ague", "ahed", "ahem", "ahis", "ahoy", "aide", "aids",
    "ails", "aims", "ains", "airn", "airs", "airt", "airy", "aits", "ajar", "ajee", "ajis", "akee",
    "akin", "alae", "alan", "alar", "alas", "alba", "albs", "alec", "alee", "alef", "ales", "alex",
    "alfa", "alga", "alif", "alit", "alky", "alls", "ally", "alma", "alme", "alms", "aloe", "alot",
    "alow", "alps", "also", "alto", "alts", "alum", "amah", "amas", "ambo", "amen", "amia", "amid",
    "amie", "amin", "amir", "amis", "ammo", "amok", "amps", "amus", "amyl", "anal", "anas", "ands",
    "andy", "anes", "anew", "anga", "anil", "anis", "ankh", "anna", "anne", "anoa", "anon", "ansa",
    "anta", "ante", "anti", "ants", "anus", "aped", "aper", "apes", "apex", "apod", "apos", "apps",
    "apse", "aqua", "arab", "arak", "arbs", "arch", "arco", "arcs", "area", "areg", "ares", "arfs",
    "argh", "aria", "arid", "aril", "arks", "arms", "army", "arse", "arts", "arty", "arum", "arvo",
    "aryl", "asci", "asea", "ashy", "asia", "asin", "asks", "asps", "asus", "atap", "ates", "atma",
    "atom", "atop", "audi", "augh", "auks", "auld", "aunt", "aura", "auto", "aver", "aves", "avid",
    "avon", "avos", "avow", "away", "awed", "awee", "awes", "awls", "awns", "awny", "awol", "awry",
    "axal", "axed", "axel", "axes", "axil", "axis", "axle", "axon", "ayah", "ayes", "ayin", "azan",
    "azon", "baal", "baas", "baba", "babe", "babu", "baby", "bach", "back", "bade", "bads", "baff",
    "bags", "baht", "bail", "bait", "bake", "bald", "bale", "bali", "balk", "ball", "balm", "bals",
    "bams", "banc", "band", "bane", "bang", "bani", "bank", "bans", "baps", "barb", "bard", "bare",
    "barf", "bark", "barm", "barn", "bars", "base", "bash", "bask", "bass", "bast", "bate", "bath",
    "bats", "batt", "baud", "bawd", "bawk", "bawl", "bawn", "bays", "bazz", "bdsm", "bead", "beak",
    "beal", "beam", "bean", "bear", "beat", "beau", "beck", "beds", "bedu", "beef", "been", "beep",
    "beer", "bees", "beet", "begs", "bell", "bels", "belt", "bema", "bend", "bene", "bens", "bent",
    "benz", "berg", "berk", "berm", "best", "beta", "beth", "bets", "bevy", "beys", "bhut", "bias",
    "bibb", "bibe", "bibs", "bice", "bide", "bidi", "bids", "bier", "biff", "bigs", "bike", "bile",
    "bilk", "bill", "bima", "bind", "bine", "bing", "bins", "bint", "biog", "biol", "bios", "bird",
    "birk", "birl", "biro", "birr", "bise", "bish", "bisk", "bite", "bits", "bitt", "bize", "blab",
    "blae", "blag", "blah", "blam", "blat", "blaw", "bleb", "bled", "blet", "blew", "blin", "blip",
    "blob", "bloc", "blog", "blot", "blow", "blub", "blue", "blur", "blvd", "boar", "boas", "boat",
    "bobo", "bobs", "bock", "bode", "bods", "body", "boff", "bogs", "bogy", "boho", "boil", "bola",
    "bold", "bole", "boll", "bolo", "bolt", "bomb", "bond", "bone", "bong", "bonk", "bony", "boob",
    "book", "bool", "boom", "boon", "boor", "boos", "boot", "bops", "bora", "bore", "bork", "born",
    "bort", "bosh", "bosk", "boss", "bota", "both", "bots", "bott", "bout", "bowl", "bows", "boxy",
    "boyo", "boys", "bozo", "brad", "brae", "brag", "bran", "bras", "brat", "braw", "bray", "bred",
    "bree", "bren", "brew", "brie", "brig", "brim", "brin", "brio", "bris", "brit", "broo", "bros",
    "brow", "brrr", "brut", "brux", "bubo", "bubs", "bubu", "buck", "buds", "buff", "bugs", "buhl",
    "buhr", "bulb", "bulk", "bull", "bumf", "bump", "bums", "buna", "bund", "bung", "bunk", "bunn",
    "buns", "bunt", "buoy", "bura", "burb", "burd", "burg", "burk", "burl", "burn", "burp", "burr",
    "burs", "bury", "bush", "busk", "buss", "bust", "busy", "bute", "buts", "butt", "buys", "buzz",
    "byes", "byre", "byrl", "byte", "cabs", "caca", "cade", "cadi", "cads", "cafe", "caff", "cafs",
    "cage", "cagy", "caid", "cain", "cake", "caky", "calf", "calk", "call", "calm", "calo", "cals",
    "calx", "came", "cami", "camo", "camp", "cams", "cane", "cans", "cant", "cape", "caph", "capo",
    "caps", "carb", "card", "care", "cark", "carl", "carn", "carp", "carr", "cars", "cart", "casa",
    "case", "cash", "cask", "cast", "cate", "cats", "caul", "cava", "cave", "cavy", "caws", "cays",
    "cazh", "cdna", "ceca", "cede", "cedi", "cees", "ceil", "cell", "cels", "celt", "cent", "cepe",
    "ceps", "cere", "cero", "cert", "cess", "cete", "chad", "chai", "cham", "chan", "chao", "chap",
    "char", "chat", "chaw", "chay", "chef", "chem", "chen", "chew", "chez", "chia", "chic", "chid",
    "chin", "chip", "chis", "chit", "choc", "chon", "chop", "chow", "chub", "chug", "chum", "ciao",
    "cigs", "cine", "cinq", "cion", "cire", "cist", "cite", "city", "clad", "clag", "clam", "clan",
    "clap", "claw", "clay", "clef", "cleg", "clew", "clip", "clit", "clod", "clog", "clon", "clop",
    "clot", "cloy", "club", "clue", "cnet", "coal", "coat", "coax", "cobb", "cobs", "coca", "cock",
    "coco", "coda", "code", "cods", "coed", "coff", "coft", "cogs", "coho", "coif", "coil", "coin",
    "coir", "coke", "coky", "cola", "cold", "cole", "cols", "colt", "coly", "coma", "comb", "come",
    "comm", "comp", "cone", "conf", "coni", "conk", "conn", "cons", "cony", "coof", "cook", "cool",
    "coon", "coop", "coos", "coot", "cope", "cops", "copy", "cord", "core", "corf", "cork", "corm",
    "corn", "corp", "cors", "cory", "cosh", "coss", "cost", "cosy", "cote", "cots", "coup", "cove",
    "cowl", "cows", "cowy", "coxa", "coys", "cozy", "crab", "crag", "cram", "crap", "craw", "cred",
    "crew", "crib", "cris", "crit", "croc", "crop", "crow", "crud", "crus", "crux", "cruz", "ctrl",
    "cuba", "cube", "cubs", "cuds", "cued", "cues", "cuff", "cuif", "cuke", "cull", "culm", "cult",
    "cums", "cunt", "cups", "curb", "curd", "cure", "curf", "curl", "curn", "curr", "curs", "curt",
    "cusk", "cusp", "cuss", "cute", "cuts", "cwms", "cyan", "cyma", "cyme", "cyst", "czar", "dabs",
    "dace", "dada", "dado", "dads", "daff", "daft", "dags", "dahl", "dahs", "dais", "daks", "dale",
    "dals", "dame", "damn", "damp", "dams", "dana", "dang", "dank", "dans", "daps", "darb", "dare",
    "dark", "darn", "dart", "dash", "data", "date", "dato", "daub", "daut", "dave", "davy", "dawk",
    "dawn", "daws", "dawt", "days", "daze", "dead", "deaf", "deal", "dean", "dear", "debs", "debt",
    "deck", "deco", "deed", "deem", "deep", "deer", "dees", "deet", "defi", "deft", "defy", "deil",
    "deke", "dele", "delf", "deli", "dell", "dels", "delt", "deme", "demo", "demy", "dene", "deni",
    "dens", "dent", "deny", "deps", "dept", "dere", "derm", "desi", "desk", "deva", "devi", "devs",
    "dews", "dewy", "dexy", "deys", "dhak", "dhal", "dhow", "dial", "dibs", "dice", "dick", "dido",
    "didy", "died", "diel", "dies", "diet", "diff", "difs", "digs", "dike", "dill", "dime", "dims",
    "dine", "ding", "dink", "dino", "dins", "dint", "diol", "dips", "dipt", "dire", "dirk", "dirl",
    "dirt", "disc", "dish", "disk", "diss", "dist", "dita", "dite", "dits", "ditz", "diva", "dive",
    "divx", "djin", "doat", "dobe", "doby", "dock", "docs", "dodo", "doer", "does", "doff", "doge",
    "dogs", "dogy", "dohs", "doit", "dojo", "dole", "doll", "dols", "dolt", "dome", "doms", "dona",
    "done", "dong", "dons", "dont", "doob", "doom", "door", "dopa", "dope", "dopy", "dore", "dork",
    "dorm", "dorp", "dorr", "dors", "dory", "dosa", "dose", "dosh", "doss", "dost", "dote", "doth",
    "dots", "doty", "doug", "doum", "dour", "dout", "doux", "dove", "down", "dows", "doxy", "doze",
    "dozy", "drab", "drag", "dram", "drat", "draw", "dray", "dree", "dreg", "drek", "drew", "drib",
    "drip", "drop", "drub", "drug", "drum", "drys", "duad", "dual", "dubs", "duce", "duci", "duck",
    "duct", "dude", "duds", "duel", "dues", "duet", "duff", "dugs", "duit", "duke", "dull", "duly",
    "duma", "dumb", "dump", "dune", "dung", "dunk", "duns", "dunt", "duos", "dupe", "dups", "dura",
    "dure", "durn", "duro", "durr", "dusk", "dust", "duty", "dvds", "dyad", "dyed", "dyer", "dyes",
    "dyke", "dyne", "each", "earl", "earn", "ears", "ease", "east", "easy", "eath", "eats", "eaux",
    "eave", "ebay", "ebbs", "ebon", "eche", "echo", "echt", "ecos", "ecru", "ecus", "eddo", "eddy",
    "eden", "edge", "edgy", "edhs", "edit", "eeew", "eels", "eely", "eery", "effs", "efts", "egad",
    "egal", "eger", "eggs", "eggy", "egis", "egos", "eide", "eked", "ekes", "ekka", "elan", "elds",
    "elhi", "elks", "ells", "elms", "elmy", "else", "emes", "emeu", "emic", "emir", "emit", "emma",
    "emmy", "emos", "emus", "emyd", "ends", "engs", "enol", "enow", "enuf", "envy", "eons", "epee",
    "epha", "epic", "epos", "eras", "ergo", "ergs", "eric", "erik", "erne", "erns", "eros", "errs",
    "erst", "eruv", "eses", "esne", "espn", "espy", "esse", "ests", "etas", "etch", "eths", "etic",
    "etna", "etui", "euro", "eval", "even", "ever", "eves", "evil", "ewer", "ewes", "exam", "exec",
    "exed", "exes", "exit", "exon", "expo", "eyas", "eyed", "eyen", "eyer", "eyes", "eyne", "eyra",
    "eyre", "eyry", "fabs", "face", "fact", "fade", "fado", "fads", "faff", "fags", "fahs", "fail",
    "fain", "fair", "fake", "fall", "falx", "fame", "fane", "fang", "fano", "fans", "faqs", "fard",
    "fare", "farl", "farm", "faro", "fart", "fash", "fast", "fate", "fats", "faun", "faux", "fava",
    "fave", "fawn", "fays", "faze", "feal", "fear", "feat", "feck", "feds", "feeb", "feed", "feel",
    "fees", "feet", "fehs", "fell", "felt", "feme", "fems", "fend", "fens", "feod", "feof", "fere",
    "fern", "fess", "fest", "feta", "fete", "fets", "feud", "feus", "fiar", "fiat", "fibs", "fice",
    "fico", "fido", "fids", "fief", "fife", "figs", "fiji", "fila", "file", "filk", "fill", "film",
    "filo", "fils", "find", "fine", "fink", "fino", "fins", "fire", "firm", "firn", "firs", "fisc",
    "fish", "fist", "fits", "five", "fixt", "fizz", "flab", "flag", "flak", "flam", "flan", "flap",
    "flat", "flaw", "flax", "flay", "flea", "fled", "flee", "flew", "flex", "fley", "flic", "flip",
    "flir", "flit", "floc", "floe", "flog", "flop", "flow", "flub", "flue", "flus", "flux", "foal",
    "foam", "fobs", "foci", "foes", "fogs", "fogy", "fohn", "foil", "foin", "fold", "folk", "fond",
    "fons", "font", "food", "fool", "foos", "foot", "fops", "fora", "forb", "ford", "fore", "fork",
    "form", "fort", "foss", "foto", "foul", "four", "fowl", "foxy", "foys", "fozy", "frae", "frag",
    "frap", "frat", "fray", "fred", "free", "fret", "frig", "frit", "friz", "froe", "frog", "from",
    "frow", "frug", "fubs", "fuci", "fuck", "fuds", "fuel", "fugs", "fugu", "fuji", "full", "fume",
    "fumy", "fund", "funk", "funs", "furl", "furs", "fury", "fuse", "fuss", "futz", "fuze", "fuzz",
    "fyce", "fyke", "gabs", "gaby", "gach", "gadi", "gads", "gaed", "gaen", "gaes", "gaff", "gaga",
    "gage", "gags", "gain", "gait", "gala", "gale", "gall", "gals", "gama", "gamb", "game", "gamp",
    "gams", "gamy", "gane", "gang", "gaol", "gape", "gaps", "gapy", "garb", "gars", "gary", "gash",
    "gasp", "gast", "gate", "gats", "gaud", "gaum", "gaun", "gaur", "gave", "gawk", "gawp", "gays",
    "gaze", "gean", "gear", "geck", "geds", "geed", "geek", "gees", "geez", "geld", "gels", "gelt",
    "gems", "gene", "gens", "gent", "genu", "germ", "gest", "geta", "gets", "geum", "ghat", "ghee",
    "ghis", "gibe", "gibs", "gids", "gied", "gien", "gies", "gifs", "gift", "giga", "gigs", "gild",
    "gill", "gilt", "gimp", "gink", "gins", "gips", "gird", "girl", "girn", "giro", "girt", "gist",
    "gite", "gits", "give", "glad", "glam", "gled", "glee", "gleg", "glen", "gley", "glia", "glib",
    "glim", "glob", "glom", "glop", "glow", "glue", "glug", "glum", "glut", "gmbh", "gnar", "gnat",
    "gnaw", "gnus", "goad", "goal", "goas", "goat", "gobo", "gobs", "goby", "gods", "goer", "goes",
    "gogo", "goji", "gold", "golf", "gone", "gong", "good", "goof", "gook", "goon", "goop", "goos",
    "gore", "gorm", "gorp", "gory", "gosh", "goth", "goto", "gout", "gowd", "gowk", "gown", "grab",
    "grad", "gram", "gran", "gras", "grat", "gray", "gree", "greg", "grew", "grey", "grid", "grig",
    "grim", "grin", "grip", "grit", "griz", "grog", "grok", "grot", "grow", "grub", "grue", "grum",
    "guam", "guan", "guar", "guck", "gude", "guff", "guid", "gulf", "gull", "gulp", "guls", "gums",
    "gunk", "guns", "guru", "gush", "gust", "guts", "guvs", "guys", "gybe", "gyms", "gyno", "gypo",
    "gyps", "gyre", "gyri", "gyro", "gyve", "gzip", "haaf", "haar", "habu", "hack", "hade", "hadj",
    "haed", "haem", "haen", "haes", "haet", "haft", "hags", "haha", "hahs", "haik", "hail", "hair",
    "haji", "hajj", "hake", "haku", "hale", "half", "hall", "halm", "halo", "halt", "hame", "hams",
    "hand", "hang", "hank", "hans", "hant", "haps", "hard", "hare", "hark", "harl", "harm", "harp",
    "hart", "hash", "hasp", "hast", "hate", "hath", "hats", "haul", "haut", "have", "hawk", "haws",
    "hays", "haze", "hazy", "hdtv", "head", "heal", "heap", "hear", "heat", "heck", "heed", "heel",
    "heft", "hehs", "heil", "heir", "held", "hell", "helm", "helo", "help", "heme", "hemp", "hems",
    "hens", "hent", "heps", "herb", "herd", "here", "herl", "herm", "hern", "hero", "hers", "hest",
    "heth", "hets", "hewn", "hews", "hick", "hide", "hied", "hies", "high", "hike", "hila", "hili",
    "hill", "hilt", "hims", "hind", "hins", "hint", "hips", "hire", "hisn", "hiss", "hist", "hits",
    "hive", "hiya", "hmmm", "hoar", "hoax", "hobo", "hobs", "hock", "hods", "hoed", "hoer", "hoes",
    "hogg", "hogs", "hoke", "hold", "hole", "holk", "holm", "holo", "holp", "hols", "holt", "holy",
    "homa", "home", "homo", "homs", "homy", "hone", "hong", "honk", "hons", "hood", "hoof", "hook",
    "hoop", "hoot", "hope", "hops", "hora", "hork", "horn", "hose", "host", "hots", "hour", "hove",
    "howe", "howf", "howk", "howl", "hows", "hoya", "hoys", "href", "html", "http", "hubs", "huck",
    "hued", "hues", "huff", "huge", "hugh", "hugo", "hugs", "huic", "hula", "hulk", "hull", "hump",
    "hums", "hung", "hunh", "hunk", "huns", "hunt", "hurl", "hurt", "hush", "husk", "huts", "hwan",
    "hwyl", "hyla", "hymn", "hype", "hypo", "hyps", "hyte", "iamb", "ibex", "ibis", "iced", "ices",
    "ichs", "icks", "icky", "icon", "idea", "idem", "ides", "idle", "idly", "idol", "idyl", "ieee",
    "iffy", "iggs", "iglu", "ikat", "ikon", "ilea", "ilex", "ilia", "ilka", "ilks", "ills", "illy",
    "imam", "imid", "immy", "impi", "imps", "inby", "inch", "incl", "info", "inia", "inks", "inky",
    "inly", "inns", "inro", "inti", "intl", "into", "ions", "iota", "iowa", "ipaq", "ipod", "iran",
    "iraq", "ired", "ires", "irid", "iris", "irks", "iron", "isba", "isbn", "isle", "isms", "issn",
    "itch", "item", "iwis", "ixia", "izar", "jabs", "jack", "jade", "jagg", "jags", "jail", "jake",
    "jamb", "jams", "jane", "jape", "jarl", "jars", "jato", "jauk", "jaup", "java", "jaws", "jays",
    "jazz", "jean", "jeed", "jeep", "jeer", "jees", "jeez", "jefe", "jeff", "jehu", "jell", "jeon",
    "jerk", "jess", "jest", "jete", "jets", "jeux", "jews", "jiao", "jibb", "jibe", "jibs", "jiff",
    "jigs", "jill", "jilt", "jimp", "jink", "jinn", "jins", "jinx", "jird", "jism", "jive", "jivy",
    "jizz", "joan", "jobs", "jock", "joel", "joes", "joey", "jogs", "john", "join", "joke", "joky",
    "jole", "jolt", "jook", "jose", "josh", "joss", "jota", "jots", "jouk", "jowl", "jows", "joys",
    "jpeg", "juan", "juba", "jube", "juco", "judo", "judy", "juga", "jugs", "juju", "juke", "juku",
    "july", "jump", "june", "junk", "jupe", "jura", "jury", "just", "jute", "juts", "kaas", "kabs",
    "kadi", "kaes", "kafs", "kagu", "kaif", "kail", "kain", "kaka", "kaki", "kale", "kame", "kami",
    "kana", "kane", "kaon", "kapa", "kaph", "kapu", "karl", "karn", "kart", "kata", "kate", "kats",
    "kava", "kayo", "kays", "kbar", "keas", "keck", "keef", "keek", "keel", "keen", "keep", "keet",
    "kefs", "kegs", "keir", "kelp", "kelt", "kemp", "keno", "kens", "kent", "kepi", "keps", "kept",
    "kerb", "kerf", "kern", "keta", "keto", "keys", "khaf", "khan", "khat", "khet", "khis", "kibe",
    "kick", "kids", "kief", "kier", "kifs", "kill", "kiln", "kilo", "kilt", "kina", "kind", "kine",
    "king", "kink", "kino", "kins", "kips", "kirk", "kirn", "kirs", "kiss", "kist", "kite", "kith",
    "kits", "kiva", "kiwi", "klik", "knap", "knar", "knee", "knew", "knit", "knob", "knop", "knot",
    "know", "knur", "koan", "koas", "kobo", "kobs", "koel", "kohl", "kois", "koji", "kola", "kolo",
    "kong", "konk", "kook", "koph", "kops", "kora", "kore", "kors", "koss", "koto", "krai", "kray",
    "kris", "kudo", "kudu", "kues", "kufi", "kuna", "kune", "kurt", "kuru", "kvas", "kyak", "kyar",
    "kyat", "kyes", "kyle", "kyte", "labs", "lace", "lack", "lacs", "lacy", "lade", "lads", "lady",
    "lags", "lahs", "laic", "laid", "lain", "lair", "lake", "lakh", "laky", "lall", "lama", "lamb",
    "lame", "lamp", "lams", "land", "lane", "lang", "lank", "laos", "laps", "lard", "lari", "lark",
    "larn", "lars", "lase", "lash", "lass", "last", "late", "lath", "lati", "lats", "latu", "laud",
    "lava", "lave", "lavs", "lawn", "laws", "lays", "laze", "lazy", "lead", "leaf", "leak", "leal",
    "lean", "leap", "lear", "leas", "lech", "lede", "leek", "leer", "lees", "leet", "left", "legs",
    "lehr", "leis", "leke", "leks", "leku", "lend", "leno", "lens", "lent", "leon", "lept", "less",
    "lest", "lets", "leud", "leva", "levo", "levs", "levy", "lewd", "leys", "liar", "lias", "libs",
    "lice", "lich", "lick", "lido", "lids", "lied", "lief", "lien", "lier", "lies", "lieu", "life",
    "lift", "like", "lilo", "lilt", "lily", "lima", "limb", "lime", "limn", "limo", "limp", "limy",
    "line", "ling", "link", "linn", "lino", "lins", "lint", "liny", "lion", "lipa", "lipe", "lipo",
    "lips", "lira", "lire", "liri", "lisa", "lisp", "list", "lite", "lits", "litu", "live", "load",
    "loaf", "loam", "loan", "lobe", "lobo", "lobs", "loca", "loch", "loci", "lock", "loco", "lode",
    "loft", "loge", "logo", "logs", "logy", "loid", "loin", "loll", "lone", "long", "loof", "look",
    "loom", "loon", "loop", "loos", "loot", "lope", "lops", "lord", "lore", "lorn", "lory", "lose",
    "loss", "lost", "lota", "loth", "loti", "loto", "lots", "loud", "loup", "lour", "lout", "love",
    "lowe", "lown", "lows", "luau", "lube", "luce", "luck", "lucy", "lude", "ludo", "luds", "lues",
    "luff", "luge", "lugs", "luis", "luke", "lull", "lulu", "luma", "lump", "lums", "luna", "lune",
    "lung", "lunk", "luns", "lunt", "luny", "lure", "lurk", "lush", "lust", "lute", "lutz", "luvs",
    "luxe", "lwei", "lych", "lyes", "lynn", "lynx", "lyre", "lyse", "maar", "mabe", "mace", "mach",
    "mack", "macs", "made", "mads", "maes", "mage", "magi", "mags", "maid", "mail", "maim", "main",
    "mair", "make", "maki", "mako", "male", "mali", "mall", "malm", "malt", "mama", "mams", "mana",
    "mane", "mano", "mans", "many", "maps", "mara", "marc", "mare", "mark", "marl", "mars", "mart",
    "mary", "masa", "mash", "mask", "mass", "mast", "mate", "math", "mats", "matt", "maud", "maui",
    "maul", "maun", "maut", "mawn", "maws", "maxi", "maya", "mayo", "mays", "maze", "mazy", "mead",
    "meal", "mean", "meat", "mech", "meds", "meed", "meek", "meet", "mega", "megs", "meld", "mell",
    "mels", "melt", "meme", "memo", "mems", "mend", "meno", "mens", "ment", "menu", "meou", "meow",
    "merc", "mere", "merk", "merl", "mesa", "mesh", "mess", "meta", "mete", "meth", "mewl", "mews",
    "meze", "mhos", "mibs", "mica", "mice", "mics", "midi", "mids", "mien", "miff", "migg", "migs",
    "mike", "mild", "mile", "milf", "milk", "mill", "milo", "mils", "milt", "mime", "mina", "mind",
    "mine", "mini", "mink", "mins", "mint", "minx", "mips", "mire", "miri", "mirk", "mirs", "miry",
    "misc", "mise", "miso", "miss", "mist", "mite", "mitt", "mity", "mixt", "moan", "moas", "moat",
    "mobs", "mock", "mocs", "mode", "modi", "mods", "mofo", "mogs", "moho", "moil", "mojo", "moke",
    "mola", "mold", "mole", "moll", "mols", "molt", "moly", "mome", "momi", "moms", "monk", "mono",
    "mons", "mony", "mood", "mook", "mool", "moon", "moor", "moos", "moot", "mope", "mops", "mopy",
    "mora", "more", "morn", "mors", "mort", "mosh", "mosk", "moss", "most", "mote", "moth", "mots",
    "mott", "moue", "move", "mown", "mows", "moxa", "mozo", "mpeg", "mrna", "msie", "much", "muck",
    "muds", "muff", "mugg", "mugs", "mule", "mull", "mumm", "mump", "mums", "mumu", "mung", "muni",
    "muns", "muon", "mura", "mure", "murk", "murr", "muse", "mush", "musk", "muso", "muss", "must",
    "mute", "muts", "mutt", "muze", "mycs", "myna", "myth", "naan", "nabe", "nabs", "nada", "naes",
    "naff", "naga", "nags", "naif", "nail", "nala", "name", "nana", "nano", "nans", "naoi", "naos",
    "napa", "nape", "naps", "narc", "nard", "nark", "nary", "nasa", "nato", "nave", "navs", "navy",
    "nays", "nazi", "ncaa", "neap", "near", "neat", "nebs", "neck", "need", "neem", "neep", "negs",
    "neif", "neil", "nema", "nene", "neon", "nerd", "ness", "nest", "nets", "nett", "neuk", "neum",
    "neve", "nevi", "newb", "news", "newt", "next", "nibs", "nice", "nick", "nide", "nidi", "niff",
    "nigh", "nike", "nill", "nils", "nims", "nine", "nipa", "nips", "nisi", "nite", "nits", "nixe",
    "nixy", "nobs", "nock", "node", "nodi", "nods", "noel", "noes", "nogg", "nogs", "noil", "noir",
    "nolo", "noma", "nome", "noms", "nona", "none", "noni", "nook", "noon", "nope", "nori", "norm",
    "nose", "nosh", "nosy", "nota", "note", "noun", "nous", "nova", "nows", "nowt", "ntsc", "nubs",
    "nude", "nuff", "nugs", "nuke", "null", "numb", "nuns", "nurd", "nurl", "nuts", "nyah", "oafs",
    "oaks", "oaky", "oars", "oast", "oath", "oats", "oaty", "obas", "obes", "obey", "obia", "obis",
    "obit", "oboe", "obol", "ocas", "oche", "oclc", "odah", "odas", "odds", "odea", "odes", "odic",
    "odor", "odyl", "oecd", "offa", "offs", "ogam", "ogee", "ogle", "ogre", "ohed", "ohia", "ohio",
    "ohms", "oiks", "oils", "oily", "oink", "okas", "okay", "okeh", "okes", "okra", "olde", "olds",
    "oldy", "olea", "oleo", "oles", "olio", "olla", "oman", "omas", "omen", "omer", "omit", "once",
    "ones", "only", "onos", "onto", "onus", "onyx", "oohs", "oops", "oots", "ooze", "oozy", "opah",
    "opal", "opas", "oped", "open", "opes", "opts", "opus", "orad", "oral", "orbs", "orby", "orca",
    "orcs", "ordo", "ores", "orgs", "orgy", "orle", "orra", "orts", "oryx", "orzo", "osar", "oses",
    "ossa", "otic", "otto", "ouch", "ouds", "ouph", "ours", "oust", "outa", "outs", "ouzo", "oval",
    "oven", "over", "ovum", "owed", "owen", "owes", "owie", "owls", "owly", "owns", "owse", "owts",
    "oxen", "oxer", "oxes", "oxic", "oxid", "oxim", "oyer", "oyes", "oyez", "paan", "paca", "pace",
    "pack", "pacs", "pact", "pacy", "padi", "pads", "page", "paid", "paik", "pail", "pain", "pair",
    "paks", "pale", "pali", "pall", "palm", "palp", "pals", "paly", "pams", "pane", "pang", "pans",
    "pant", "papa", "paps", "para", "pard", "pare", "park", "parr", "pars", "part", "pase", "pash",
    "paso", "pass", "past", "pate", "path", "pats", "paty", "paua", "paul", "pave", "pawl", "pawn",
    "paws", "pays", "pdas", "peag", "peak", "peal", "pean", "pear", "peas", "peat", "pech", "peck",
    "pecs", "peds", "peed", "peek", "peel", "peen", "peep", "peer", "pees", "pegs", "pehs", "pein",
    "peke", "pele", "pelf", "pelt", "pend", "penn", "pens", "pent", "peon", "pepo", "peps", "perc",
    "pere", "peri", "perk", "perl", "perm", "perp", "pert", "peru", "perv", "peso", "pest", "pete",
    "pets", "pews", "pfft", "pfui", "phat", "phew", "phil", "phis", "phiz", "phon", "phos", "phot",
    "phut", "phys", "pial", "pian", "pias", "pica", "pice", "pick", "pics", "pied", "pier", "pies",
    "pigs", "pika", "pike", "piki", "pile", "pili", "pill", "pily", "pima", "pimp", "pina", "pine",
    "ping", "pink", "pins", "pint", "piny", "pion", "pipa", "pipe", "pips", "pipy", "pirn", "pish",
    "piso", "piss", "pita", "pith", "pits", "pity", "pixy", "plan", "plat", "play", "plea", "pleb",
    "pled", "plew", "plex", "plie", "plod", "plop", "plot", "plow", "ploy", "plug", "plum", "plus",
    "pmid", "pock", "poco", "pods", "poem", "poet", "pogo", "pogy", "pois", "poke", "poky", "pole",
    "poll", "polo", "pols", "poly", "pome", "pomo", "pomp", "poms", "pond", "pone", "pong", "pons",
    "pony", "pood", "poof", "pooh", "pool", "poon", "poop", "poor", "poos", "pope", "pops", "pore",
    "pork", "porn", "port", "pose", "posh", "post", "posy", "pots", "pouf", "pour", "pout", "pows",
    "poxy", "pram", "prao", "prat", "prau", "pray", "pree", "prep", "prev", "prex", "prey", "prez",
    "prig", "prim", "prix", "proa", "prob", "proc", "prod", "prof", "prog", "prom", "prop", "pros",
    "prot", "prow", "psis", "psst", "ptui", "pubs", "puce", "puck", "puds", "pudu", "puff", "pugh",
    "pugs", "puja", "puke", "pula", "pule", "puli", "pulk", "pull", "pulp", "puls", "puma", "pump",
    "puna", "pung", "punk", "puns", "punt", "puny", "pupa", "pups", "pupu", "pure", "puri", "purl",
    "purr", "purs", "push", "puss", "puts", "putt", "putz", "pyas", "pyes", "pyic", "pyin", "pyre",
    "pyro", "qadi", "qaid", "qats", "qoph", "quad", "quag", "quai", "quay", "quey", "quid", "quin",
    "quip", "quit", "quiz", "quod", "race", "rack", "racy", "rads", "raff", "raft", "raga", "rage",
    "ragg", "ragi", "rags", "raia", "raid", "rail", "rain", "rais", "raja", "rake", "raki", "raku",
    "rale", "rami", "ramp", "rams", "rand", "rang", "rani", "rank", "rant", "rape", "raps", "rapt",
    "rare", "rase", "rash", "rasp", "rate", "rath", "rato", "rats", "rave", "raws", "raya", "rays",
    "raze", "razz", "read", "real", "ream", "reap", "rear", "rebs", "reck", "recs", "redd", "rede",
    "redo", "reds", "reed", "reef", "reek", "reel", "rees", "refs", "reft", "regs", "reid", "reif",
    "rein", "reis", "rely", "rems", "rend", "reno", "rent", "repo", "repp", "reps", "resh", "rest",
    "rete", "rets", "revs", "rhea", "rhos", "rhus", "rial", "rias", "ribs", "rica", "rice", "rich",
    "rick", "rico", "ride", "rids", "riel", "rife", "riff", "rifs", "rift", "rigs", "rile", "rill",
    "rime", "rims", "rimy", "rind", "ring", "rink", "rins", "riot", "ripe", "rips", "rise", "risk",
    "rite", "ritz", "rive", "road", "roam", "roan", "roar", "robe", "robs", "rock", "rocs", "rode",
    "rods", "roes", "roil", "role", "rolf", "roll", "rome", "romp", "roms", "rood", "roof", "rook",
    "room", "roos", "root", "rope", "ropy", "rosa", "rose", "ross", "rosy", "rota", "rote", "roti",
    "rotl", "roto", "rots", "roue", "roup", "rout", "roux", "rove", "rows", "rube", "rubs", "ruby",
    "ruck", "rudd", "rude", "rued", "ruer", "rues", "ruff", "ruga", "rugs", "ruin", "rukh", "rule",
    "ruly", "rump", "rums", "rune", "rung", "runs", "runt", "ruse", "rush", "rusk", "rust", "ruth",
    "ruts", "ryan", "ryas", "ryes", "ryke", "rynd", "ryot", "ryus", "sabe", "sabs", "sack", "sacs",
    "sade", "sadi", "safe", "saga", "sage", "sago", "sags", "sagy", "said", "sail", "sain", "sake",
    "saki", "sale", "sall", "salp", "sals", "salt", "same", "samp", "sand", "sane", "sang", "sank",
    "sans", "saps", "sara", "sard", "sari", "sark", "sash", "sass", "sate", "sati", "saul", "save",
    "sawn", "saws", "says", "scab", "scad", "scag", "scam", "scan", "scar", "scat", "scop", "scot",
    "scow", "scry", "scsi", "scud", "scum", "scup", "scut", "seal", "seam", "sean", "sear", "seas",
    "seat", "secs", "sect", "seed", "seek", "seel", "seem", "seen", "seep", "seer", "sees", "sega",
    "sego", "segs", "seif", "seis", "self", "sell", "sels", "seme", "semi", "send", "sene", "sent",
    "seps", "sept", "sera", "sere", "serf", "sers", "sesh", "seta", "sets", "sett", "sevs", "sewn",
    "sews", "sexo", "sext", "sexy", "shad", "shag", "shah", "sham", "shat", "shaw", "shay", "shea",
    "shed", "shen", "shes", "shew", "shhh", "shim", "shin", "ship", "shit", "shiv", "shmo", "shod",
    "shoe", "shog", "shoo", "shop", "shot", "show", "shri", "shul", "shun", "shut", "shwa", "sial",
    "sibb", "sibs", "sice", "sick", "sics", "side", "sidh", "sift", "sigh", "sign", "sigs", "sika",
    "sike", "sild", "silk", "sill", "silo", "silt", "sima", "simp", "sims", "sine", "sing", "sinh",
    "sink", "sins", "sipe", "sips", "sire", "sirs", "site", "sith", "sits", "size", "sizy", "skag",
    "skas", "skat", "sked", "skee", "skeg", "skep", "skew", "skid", "skim", "skin", "skip", "skis",
    "skit", "skol", "skry", "skua", "slab", "slag", "slam", "slap", "slat", "slaw", "slay", "sled",
    "slew", "slid", "slim", "slip", "slit", "slob", "sloe", "slog", "slop", "slot", "slow", "slub",
    "slue", "slug", "slum", "slur", "slut", "smew", "smit", "smog", "smtp", "smug", "smut", "snag",
    "snap", "snaw", "sned", "snib", "snip", "snit", "snob", "snog", "snot", "snow", "snub", "snug",
    "snye", "soak", "soap", "soar", "soba", "sobs", "soca", "sock", "soda", "sods", "sofa", "soft",
    "sohs", "soil", "soja", "soju", "soke", "sola", "sold", "sole", "soli", "solo", "sols", "soma",
    "some", "soms", "sone", "song", "sons", "sony", "sook", "soon", "soot", "soph", "sops", "sora",
    "sorb", "sord", "sore", "sori", "sorn", "sort", "soth", "sots", "souk", "soul", "soup", "sour",
    "sous", "sown", "sows", "soya", "soys", "spae", "spam", "span", "spar", "spas", "spat", "spay",
    "spec", "sped", "spew", "spin", "spit", "spiv", "spot", "spry", "spud", "spue", "spun", "spur",
    "sris", "stab", "stag", "stan", "star", "stat", "staw", "stay", "stem", "step", "stet", "stew",
    "stey", "stir", "stoa", "stob", "stop", "stot", "stow", "stub", "stud", "stum", "stun", "stye",
    "suba", "subs", "such", "suck", "sudd", "suds", "sued", "suer", "sues", "suet", "sugh", "suit",
    "sukh", "suks", "sulk", "sulu", "sumi", "sumo", "sump", "sums", "sumy", "sung", "sunk", "sunn",
    "suns", "supe", "sups", "suqs", "sura", "surd", "sure", "surf", "suse", "suss", "swab", "swag",
    "swam", "swan", "swap", "swat", "sway", "swig", "swim", "swob", "swop", "swot", "swum", "sybo",
    "syce", "syke", "syli", "sync", "syne", "syph", "tabs", "tabu", "tace", "tach", "tack", "taco",
    "tact", "tads", "tael", "tags", "tahr", "tail", "tain", "taka", "take", "tala", "talc", "tale",
    "tali", "talk", "tall", "tame", "tamp", "tams", "tang", "tank", "tans", "taos", "tapa", "tape",
    "taps", "tare", "tarn", "taro", "tarp", "tars", "tart", "tase", "task", "tass", "tate", "tats",
    "taus", "taut", "tavs", "taws", "taxa", "taxi", "teak", "teal", "team", "tear", "teas", "teat",
    "tech", "tecs", "teds", "teed", "teel", "teem", "teen", "tees", "teff", "tegg", "tegs", "tegu",
    "tein", "tela", "tele", "tell", "tels", "temp", "tend", "tens", "tent", "tepa", "term", "tern",
    "test", "teth", "tets", "tews", "text", "thae", "thai", "than", "that", "thaw", "thee", "them",
    "then", "thew", "they", "thin", "thio", "thir", "this", "thou", "thro", "thru", "thud", "thug",
    "thus", "tian", "tick", "tics", "tide", "tidy", "tied", "tier", "ties", "tiff", "tike", "tiki",
    "tile", "till", "tils", "tilt", "time", "tine", "ting", "tins", "tint", "tiny", "tion", "tipi",
    "tips", "tire", "tirl", "tiro", "titi", "tits", "tivy", "tiyn", "tizz", "toad", "toby", "tock",
    "toco", "todd", "tods", "tody", "toea", "toed", "toes", "toff", "toft", "tofu", "toga", "togs",
    "toil", "toit", "toke", "tola", "told", "tole", "toll", "tolt", "tolu", "tomb", "tome", "toms",
    "tone", "tong", "tons", "tony", "took", "tool", "toom", "toon", "toot", "tope", "toph", "topi",
    "topo", "tops", "tora", "torc", "tore", "tori", "torn", "toro", "torr", "tors", "tort", "tory",
    "tosa", "tosh", "toss", "tost", "tote", "tots", "tour", "tout", "town", "tows", "towy", "toyo",
    "toys", "trad", "tram", "trap", "tray", "tree", "tref", "trek", "trem", "treo", "tres", "tret",
    "trey", "trig", "trim", "trio", "trip", "trod", "trog", "trop", "trot", "trou", "trow", "troy",
    "true", "trug", "tsar", "tsks", "tuba", "tube", "tubs", "tuck", "tufa", "tuff", "tuft", "tugs",
    "tuis", "tule", "tump", "tums", "tuna", "tune", "tung", "tuns", "tups", "turd", "turf", "turk",
    "turn", "turr", "tush", "tusk", "tuts", "tutu", "twae", "twas", "twee", "twig", "twin", "twit",
    "twos", "tyee", "tyer", "tyes", "tyin", "tyke", "tyne", "type", "typo", "typp", "typy", "tyre",
    "tyro", "tzar", "udon", "udos", "ughs", "ugly", "ukes", "ulan", "ulna", "ulus", "ulva", "umbo",
    "umma", "umph", "umps", "unai", "unau", "unbe", "unci", "unco", "unde", "undo", "undy", "unis",
    "unit", "univ", "unix", "unto", "upas", "upby", "updo", "upon", "urbs", "urds", "urea", "urge",
    "uric", "urls", "urns", "urps", "ursa", "urus", "usda", "used", "user", "uses", "usgs", "usps",
    "utah", "utas", "utes", "uvea", "vacs", "vagi", "vail", "vain", "vair", "vale", "vamp", "vane",
    "vang", "vans", "vape", "vara", "vars", "vary", "vasa", "vase", "vast", "vats", "vatu", "vaus",
    "vavs", "vaws", "veal", "veep", "veer", "vees", "vega", "veil", "vein", "vela", "veld", "vena",
    "vend", "vent", "vera", "verb", "vert", "very", "vest", "veto", "vets", "vext", "vial", "vibe",
    "vice", "vide", "vids", "vied", "vier", "vies", "view", "viff", "viga", "vigs", "viii", "vile",
    "vill", "vims", "vina", "vine", "vino", "vins", "viny", "viol", "virl", "visa", "vise", "vita",
    "viva", "vive", "vlei", "vlog", "voes", "vogs", "void", "voip", "vole", "volk", "volt", "vote",
    "vows", "vrow", "vugg", "vugh", "vugs", "vuln", "waah", "wabs", "wack", "wade", "wadi", "wads",
    "wady", "waes", "waff", "waft", "wage", "wags", "waif", "wail", "wain", "wair", "wait", "wake",
    "wale", "wali", "walk", "wall", "walt", "waly", "wame", "wand", "wane", "wang", "wank", "wans",
    "want", "wany", "waps", "ward", "ware", "wark", "warm", "warn", "warp", "wars", "wart", "wary",
    "wash", "wasp", "wast", "wats", "watt", "wauk", "waul", "waur", "wave", "wavy", "wawl", "waws",
    "waxy", "ways", "weak", "weal", "wean", "wear", "webs", "weds", "weed", "week", "weel", "ween",
    "weep", "weer", "wees", "weet", "weft", "weir", "weka", "weld", "well", "welt", "wend", "wens",
    "went", "wept", "were", "wert", "west", "weta", "wets", "wham", "whap", "what", "whee", "when",
    "whet", "whew", "whey", "whid", "whig", "whim", "whin", "whip", "whir", "whit", "whiz", "whoa",
    "whom", "whop", "whup", "whys", "wich", "wick", "wide", "wife", "wifi", "wigs", "wiki", "wild",
    "wile", "will", "wilt", "wily", "wimp", "wind", "wine", "wing", "wink", "wino", "wins", "winy",
    "wipe", "wire", "wiry", "wise", "wish", "wisp", "wiss", "wist", "wite", "with", "wits", "wive",
    "woad", "woes", "woke", "woks", "wold", "wolf", "womb", "wonk", "wons", "wont", "wood", "woof",
    "wool", "woos", "word", "wore", "work", "worm", "worn", "wort", "wost", "wots", "wove", "wows",
    "wrap", "wren", "writ", "wuss", "wych", "wyes", "wyle", "wynd", "wynn", "wyns", "wyte", "xbox",
    "xnxx", "xyst", "yack", "yaff", "yage", "yagi", "yags", "yaks", "yald", "yale", "yams", "yang",
    "yank", "yaps", "yard", "yare", "yarn", "yaud", "yaup", "yawl", "yawn", "yawp", "yaws", "yays",
    "yeah", "yean", "year", "yeas", "yech", "yegg", "yeld", "yelk", "yell", "yelp", "yens", "yeow",
    "yeps", "yerk", "yeti", "yett", "yeuk", "yews", "yill", "yins", "yipe", "yips", "yird", "yirr",
    "ylem", "yobs", "yock", "yodh", "yods", "yoga", "yogh", "yogi", "yoke", "yoks", "yolk", "yomp",
    "yond", "yoni", "yoof", "yore", "york", "your", "yous", "yowe", "yowl", "yows", "yuan", "yuca",
    "yuch", "yuck", "yuga", "yuke", "yuks", "yule", "yups", "yurt", "yutz", "yuzu", "ywis", "zags",
    "zany", "zaps", "zarf", "zeal", "zebu", "zeda", "zeds", "zees", "zein", "zeks", "zeps", "zerk",
    "zero", "zest", "zeta", "zigs", "zill", "zinc", "zine", "zing", "zins", "zips", "ziti", "zits",
    "zizz", "zoea", "zoic", "zona", "zone", "zonk", "zoom", "zoon", "zoos", "zope", "zori", "zouk",
    "zyme"
  ];

  var ANSWERS = window.WORD_LISTS.answers;
  var DICTIONARY = new Set(window.WORD_LISTS.guesses);
  var PROBES = new Set(PROBE_WORDS);

  var boardEl = document.getElementById("board");
  var turnlineEl = document.getElementById("turnline");
  var bannerEl = document.getElementById("banner");
  var toastEl = document.getElementById("toast");
  var newBtn = document.getElementById("new-btn");
  var shareBtn = document.getElementById("share-btn");
  var keyboardEl = document.getElementById("keyboard");

  var answer = "";
  var done = false;
  var won = false;
  var revealing = false;
  var practice = false;
  var quietRows = false; // restore flag: rebuilt rows skip enter animations
  var guesses = [];      // { w: word, t: "p" | "c" }
  var typed = [];        // the active row's letters
  var rowEls = [];
  var keyEls = {};
  var toastTimer = null;

  // ---------- daily puzzle ----------

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function answerFor(key) {
    var h = 0;
    var s = SALT + key;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return ANSWERS[h % ANSWERS.length];
  }

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); }
    catch (e) { return null; }
  }

  function saveState() {
    if (practice) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        date: todayKey(),
        answer: answer,
        guesses: guesses,
        done: done,
        won: won
      }));
    } catch (e) { /* storage unavailable — game still playable */ }
  }

  // ---------- wobble mechanics ----------

  // The 1st, 3rd, 5th… probe reads columns 1-4; the 2nd, 4th… reads 2-5.
  function probeWindow(index) {
    return index % 2 === 0 ? ODD : EVEN;
  }

  function probeCount() {
    var n = 0;
    for (var i = 0; i < guesses.length; i++) if (guesses[i].t === "p") n++;
    return n;
  }

  // Two-pass Wordle scoring over equal-length strings — commits only.
  function evaluate(guess, target) {
    var marks = Array(guess.length).fill("absent");
    var left = {};
    for (var i = 0; i < target.length; i++) {
      if (guess.charAt(i) === target.charAt(i)) marks[i] = "correct";
      else left[target.charAt(i)] = (left[target.charAt(i)] || 0) + 1;
    }
    for (var j = 0; j < target.length; j++) {
      if (marks[j] !== "correct" && left[guess.charAt(j)] > 0) {
        marks[j] = "present";
        left[guess.charAt(j)]--;
      }
    }
    return marks;
  }

  // Probe scoring: greens are positional against the window's columns only,
  // but yellows count against the WHOLE answer — a letter living in the
  // hidden column still surfaces as present, so presence info never goes
  // dark just because a column is out of view. Only position is windowed.
  function evaluateProbe(guess, cols) {
    var marks = Array(cols.length).fill("absent");
    var left = {};
    for (var i = 0; i < COLS; i++) {
      left[answer.charAt(i)] = (left[answer.charAt(i)] || 0) + 1;
    }
    for (var j = 0; j < cols.length; j++) {
      if (guess.charAt(j) === answer.charAt(cols[j])) {
        marks[j] = "correct";
        left[guess.charAt(j)]--;
      }
    }
    for (var k = 0; k < cols.length; k++) {
      if (marks[k] !== "correct" && left[guess.charAt(k)] > 0) {
        marks[k] = "present";
        left[guess.charAt(k)]--;
      }
    }
    return marks;
  }

  // One source of truth for what a guess would score, used by play, share,
  // restore and dump.
  function marksForGuess(g, probeIndex) {
    var isProbe = g.t === "p";
    var cols = isProbe ? probeWindow(probeIndex) : [0, 1, 2, 3, 4];
    var marks = isProbe ? evaluateProbe(g.w, cols) : evaluate(g.w, answer);
    return { cols: cols, marks: marks };
  }

  // ---------- board ----------

  function activeRow() { return rowEls[guesses.length]; }
  function commitOnly() { return guesses.length === TURNS - 1; }

  function resetBoard() {
    done = false;
    won = false;
    revealing = false;
    guesses = [];
    typed = [];
    rowEls = [];

    boardEl.innerHTML = "";
    bannerEl.classList.remove("show");
    bannerEl.textContent = "";
    shareBtn.classList.add("hidden");
    addRow();
    buildKeyboard();
    updateTurnline();
  }

  // Rows are the staggered bricks: 4 tiles riding the next probe's window,
  // or flat and full-width once a commit is on the table.
  function addRow() {
    var row = document.createElement("div");
    row.className = "wrow" + (quietRows ? " quiet" : "");
    for (var c = 0; c < COLS; c++) {
      var tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    boardEl.appendChild(row);
    rowEls.push(row);
    layoutRow(row);
  }

  // Pending rows: probe layout (4 slots at the next window's offset) unless
  // a commit is being typed or the turn-8 commit is due.
  function layoutRow(row) {
    if (row !== activeRow() || done) return;
    var commitMode = commitOnly() || typed.length === COLS;
    var even = !commitMode && probeCount() % 2 === 1;
    row.classList.toggle("even", even);
    row.children[COLS - 1].style.display = commitMode ? "" : "none";
    var slots = commitMode ? COLS : PROBE_LEN;
    for (var c = 0; c < COLS; c++) {
      row.children[c].classList.toggle("inplay", c < slots);
    }
  }

  function renderActive() {
    var row = activeRow();
    if (!row) return;
    for (var c = 0; c < COLS; c++) {
      var t = row.children[c];
      if (c < typed.length) {
        t.textContent = typed[c];
        t.classList.add("filled");
      } else {
        t.textContent = "";
        t.classList.remove("filled");
      }
    }
    layoutRow(row);
  }

  // ---------- countdown ----------

  function updateTurnline() {
    var turn = Math.min(guesses.length + 1, TURNS);
    if (commitOnly()) {
      turnlineEl.textContent = "Guess " + turn + " of " + TURNS + " \u2014 answer only";
      turnlineEl.classList.add("final");
    } else {
      turnlineEl.textContent = "Guess " + turn + " of " + TURNS;
      turnlineEl.classList.remove("final");
    }
  }

  // ---------- typing ----------

  function onKey(key) {
    if (done || revealing) return;
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") { erase(); return; }
    if (/^[a-z]$/.test(key)) typeLetter(key);
  }

  function typeLetter(ch) {
    if (typed.length >= COLS) return;
    typed.push(ch);
    renderActive();
  }

  function erase() {
    if (!typed.length) return;
    typed.pop();
    renderActive();
  }

  // ---------- submitting ----------

  function submit() {
    var word = typed.join("");
    var row = activeRow();
    // A rejected attempt leaves `shake` behind; equal specificity, defined
    // after .reveal, it would override the flip — clear it first.
    Array.prototype.forEach.call(row.children, function (t) {
      t.classList.remove("shake");
    });

    if (word.length < PROBE_LEN) { reject("Not enough letters"); return; }
    if (word.length === PROBE_LEN) {
      if (commitOnly()) { reject("Turn 8 is commit only"); return; }
      if (!PROBES.has(word)) { reject("Not in word list"); return; }
      playProbe(row, word);
      return;
    }
    if (!DICTIONARY.has(word)) { reject("Not in word list"); return; }
    playCommit(row, word);
  }

  function playProbe(row, word) {
    revealing = true;
    var cols = probeWindow(probeCount());
    var marks = evaluateProbe(word, cols);
    reveal(row, marks, function () { finishProbe(row, word, cols, marks); });
  }

  function playCommit(row, word) {
    revealing = true;
    var marks = evaluate(word, answer);
    reveal(row, marks, function () { finishCommit(row, word, marks); });
  }

  function reveal(row, marks, onDone) {
    for (var c = 0; c < marks.length; c++) {
      var t = row.children[c];
      setTimeout(function (tile) { tile.classList.add("reveal"); },
        100 + c * FLIP_STAGGER, t);
      setTimeout(function (tile, mark) {
        tile.classList.remove("filled");
        tile.classList.add(mark);
      }, 100 + c * FLIP_STAGGER + FLIP_MID, t, marks[c]);
    }
    setTimeout(onDone, 100 + (marks.length - 1) * FLIP_STAGGER + FLIP_MID + 150);
  }

  // Final layout of a scored row, from its window: probes keep their
  // offset and hide the untouched 5th slot; commits sit flat, all five
  // shown. Authoritative on restore too, where rows were born as pending
  // probes and must not inherit that state.
  function applyScored(row, marks, cols) {
    var isProbe = cols.length === PROBE_LEN;
    for (var c = 0; c < marks.length; c++) {
      var t = row.children[c];
      t.classList.remove("filled", "inplay");
      t.classList.add(marks[c]);
    }
    row.classList.remove("even");
    row.classList.add("scored", isProbe ? "probe" : "commit");
    row.classList.toggle("even", isProbe && cols[0] === 1);
    row.children[COLS - 1].style.display = isProbe ? "none" : "";
  }

  function finishProbe(row, word, cols, marks) {
    applyScored(row, marks, cols);
    paintKeyboard(word, marks);
    guesses.push({ w: word, t: "p" });
    turnEnd();
  }

  function finishCommit(row, word, marks) {
    applyScored(row, marks, [0, 1, 2, 3, 4]);
    paintKeyboard(word, marks);
    guesses.push({ w: word, t: "c" });

    // A commit is all-in: correct wins on the spot, wrong loses on the
    // spot — full-word feedback is never free, or probing would be pointless.
    done = true;
    if (word === answer) {
      won = true;
      showBanner(praise(guesses.length));
    } else {
      showBanner("The word was " + answer.toUpperCase());
    }
    shareBtn.classList.remove("hidden");
    turnEnd();
  }

  function turnEnd() {
    typed = [];
    if (!done) {
      addRow();
      renderActive();
    }
    updateTurnline();
    saveState();
    revealing = false;
  }

  function praise(count) {
    return PRAISE[count - 1];
  }

  // ---------- keyboard ----------

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    keyEls = {};
    var layout = [
      "qwertyuiop".split(""),
      "asdfghjkl".split(""),
      ["Enter", "z", "x", "c", "v", "b", "n", "m", "Backspace"]
    ];
    layout.forEach(function (keys) {
      var rowEl = document.createElement("div");
      rowEl.className = "key-row";
      keys.forEach(function (k) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key" + (k.length > 1 ? " wide" : "");
        btn.textContent = k === "Backspace" ? "\u232B" : k;
        btn.setAttribute("aria-label", k);
        btn.addEventListener("click", function () { onKey(k); btn.blur(); });
        rowEl.appendChild(btn);
        if (k.length === 1) keyEls[k] = btn;
      });
      keyboardEl.appendChild(rowEl);
    });
  }

  var RANK = { absent: 1, present: 2, correct: 3 };

  function paintKeyboard(word, marks) {
    for (var i = 0; i < word.length; i++) {
      var key = keyEls[word.charAt(i)];
      if (!key) continue;
      var current = key.dataset.state || "";
      if (RANK[marks[i]] > (RANK[current] || 0)) {
        if (current) key.classList.remove(current);
        key.classList.add(marks[i]);
        key.dataset.state = marks[i];
      }
    }
  }

  // ---------- init / practice / restore ----------

  function init() {
    practice = false;
    newBtn.textContent = "Practice";
    var key = todayKey();
    var saved = loadSaved();
    if (saved && saved.date === key && saved.answer && DICTIONARY.has(saved.answer)) {
      answer = saved.answer;
      quietRows = true;
      resetBoard();
      restore(saved);
      quietRows = false;
    } else {
      answer = answerFor(key);
      resetBoard();
      saveState();
    }
  }

  // Optional word argument forces the practice answer (debugging); without
  // one it's a random daily-list word.
  function startPractice(word) {
    practice = true;
    answer = /^[a-z]{5}$/.test(word)
      ? word
      : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    resetBoard();
    newBtn.textContent = "Today\u2019s puzzle";
    showBanner("Practice round");
  }

  // Replay saved guesses with no animation; windows re-derive from the
  // running probe counter; marks rebuild from the answer.
  function restore(saved) {
    guesses = [];
    saved.guesses.forEach(function (g) {
      var row = activeRow(); // the waiting empty row
      var r = marksForGuess(g, probeCount());
      for (var c = 0; c < g.w.length; c++) {
        row.children[c].textContent = g.w.charAt(c);
        row.children[c].classList.add(r.marks[c]);
      }
      applyScored(row, r.marks, r.cols);
      paintKeyboard(g.w, r.marks);
      guesses.push(g);
      addRow();
    });
    if (saved.done) {
      done = true;
      won = !!saved.won;
      boardEl.removeChild(rowEls.pop()); // finished boards have no pending row
      if (won) showBanner(praise(guesses.length));
      else showBanner("The word was " + answer.toUpperCase());
      shareBtn.classList.remove("hidden");
    } else if (guesses.length === 0) {
      // resetBoard's row is already the waiting row
    }
    renderActive();
    updateTurnline();
  }

  // ---------- feedback ----------

  function showBanner(msg) {
    bannerEl.textContent = msg;
    bannerEl.classList.add("show");
  }

  function reject(msg) {
    toast(msg);
    Array.prototype.forEach.call(activeRow().children, function (tile) {
      if (tile.style.display === "none") return;
      tile.classList.remove("shake");
      void tile.offsetWidth; // restart the animation
      tile.classList.add("shake");
      // Drop the class once played, or it overrides the later flip animation.
      tile.addEventListener("animationend", function h(ev) {
        if (ev.animationName !== "shake") return;
        tile.removeEventListener("animationend", h);
        tile.classList.remove("shake");
      });
    });
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 1600);
  }

  // ---------- share ----------

  function share() {
    var dark = document.documentElement.dataset.theme === "dark";
    var emptyCell = dark ? "\u2B1B" : "\u2B1C";
    // Offset blank uses the inverse of the theme's empty square: same emoji
    // width as the marks, visually distinct from the absent squares, so the
    // wobble survives the paste. Even probes pad left, odd pad right.
    var blankCell = dark ? "\u2B1C" : "\u2B1B";
    var colorblind = document.documentElement.dataset.colorblind === "on";
    var EMOJI = colorblind
      ? { correct: "\uD83D\uDFE7", present: "\uD83D\uDFE6", absent: emptyCell }
      : { correct: "\uD83D\uDFE9", present: "\uD83D\uDFE8", absent: emptyCell };
    var title = ["Wobble", practice ? "practice" : todayKey(),
      (won ? guesses.length : "X") + "/" + TURNS].join(" \u00B7 ");
    var lines = [title, GAME_URL];
    var probes = 0;
    guesses.forEach(function (g) {
      var r = marksForGuess(g, probes);
      var row = g.w.split("").map(function (ch, i) {
        return EMOJI[r.marks[i]];
      }).join("");
      if (g.t === "p") row = r.cols[0] === 1 ? blankCell + row : row + blankCell;
      lines.push(row);
      if (g.t === "p") probes++;
    });
    copyText(lines.join("\n"));
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("Copied to clipboard"); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Copied to clipboard");
    } catch (e) {
      toast("Could not copy");
    }
    ta.remove();
  }

  // ---------- wiring ----------

  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toLowerCase());
    else if (e.key === "Enter" || e.key === "Backspace") {
      // Never double-fire while a button holds focus: the browser will
      // activate it too (clicking Practice mid-game, retyping a key).
      if (!e.target || e.target.tagName !== "BUTTON") onKey(e.key);
    }
  });

  newBtn.addEventListener("click", function () {
    newBtn.blur();
    if (practice) init(); else startPractice();
  });
  shareBtn.addEventListener("click", function () { shareBtn.blur(); share(); });

  init();

  // Bug reports: WOBBLE.dump() returns the full state of the game on
  // screen — every guess, its type, the window it was scored against, the
  // marks it earned, plus the raw save. Run `copy(WOBBLE.dump())` in the
  // console and paste the result into the report. Dump before refreshing:
  // a buggy practice round is gone once the page reloads.
  function dump() {
    var out = [
      "Wobble debug dump",
      "mode: " + (practice ? "practice" : "daily"),
      "answer: " + answer.toUpperCase(),
      "done: " + done + ", won: " + won
    ];
    var probes = 0;
    guesses.forEach(function (g, i) {
      var r = marksForGuess(g, probes);
      var glyph = { correct: "G", present: "Y", absent: "\u00B7" };
      var tag = r.cols.length === PROBE_LEN
        ? "probe  cols " + (r.cols[0] + 1) + "-" + (r.cols[r.cols.length - 1] + 1)
        : "commit";
      out.push((i + 1) + ". " + g.w.toUpperCase() + "  " + tag + "  " +
        r.marks.map(function (m) { return glyph[m]; }).join(""));
      if (g.t === "p") probes++;
    });
    out.push("turns: " + guesses.length + "/" + TURNS + " \u00B7 probes: " +
      probes + " \u00B7 next probe window: " + (probes % 2 === 1 ? "2-5" : "1-4"));
    if (!practice) {
      var saved = loadSaved();
      out.push("raw save: " + (saved ? JSON.stringify(saved) : "none"));
    }
    return out.join("\n");
  }

  // Small console/test surface.
  window.WOBBLE = {
    daily: init,
    practice: startPractice,
    todayKey: todayKey,
    answerFor: answerFor,
    evaluate: evaluate,
    evaluateProbe: evaluateProbe,
    probeWindow: probeWindow,
    dump: dump
  };
})();
