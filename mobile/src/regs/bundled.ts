// Built-in copy of api/regs/regs.json so the rules work with no signal. Made by: python3 api/regs/sync_app_copy.py
// (a server test checks it matches). Don't edit by hand.
import type { RegsData } from './regs';

export const BUNDLED: RegsData = {
 "version": "2026-11-03",
 "checked": "2026-11-03",
 "area": "Southern California, Point Conception to Mexico",
 "sources": {
  "southern": {
   "title": "CDFW Southern Region ocean fishing regulations",
   "url": "https://www.wildlife.ca.gov/Fishing/Ocean/Regulations/Fishing-Map/southern"
  },
  "groundfish": {
   "title": "CDFW groundfish (rockfish, lingcod) summary",
   "url": "https://wildlife.ca.gov/Fishing/Ocean/Regulations/Groundfish-Summary"
  },
  "finfish": {
   "title": "CDFW sport limits for ocean fish",
   "url": "https://wildlife.ca.gov/Regions/Marine/FAQ/general-commercial-and-recreational-recreational-what-are-the-sport-regulations-for-the-fish-species-i-am-taking"
  },
  "inverts": {
   "title": "CDFW limits for lobster, crabs, clams and other invertebrates",
   "url": "https://wildlife.ca.gov/Regions/Marine/FAQ/general-commercial-and-recreational-recreational-what-are-the-regulations-for-the-invertebrate-species-i-am-taking"
  },
  "bluefin": {
   "title": "CDFW bluefin tuna bag limit",
   "url": "https://wildlife.ca.gov/Regions/Marine/FAQ/general-commercial-and-recreational-recreational-what-is-the-sport-pacific-bluefin-tuna-bag-limit"
  },
  "barracuda": {
   "title": "California regulations §28.25 (barracuda)",
   "url": "https://regulations.justia.com/states/california/title-14/division-1/subdivision-1/chapter-4/article-1/fin-fish-minimum-size-limits-bag-and-possession-limits-and-seasons/section-28-25"
  }
 },
 "items": [
  {
   "id": "barracuda",
   "name": "California barracuda",
   "group": "fish",
   "aka": [
    "barracuda",
    "baracuda",
    "barracooda",
    "cuda",
    "barries",
    "scoots"
   ],
   "size": "28 in total length, or 17 in alternate length",
   "bag": "10 per day (within the 20-fish total)",
   "season": "Open all year",
   "notes": [],
   "src": "barracuda",
   "facts": {
    "bag": 10,
    "size": 28
   }
  },
  {
   "id": "yellowtail",
   "name": "California yellowtail",
   "group": "fish",
   "aka": [
    "yellowtail",
    "yt",
    "yellow tail",
    "forktail",
    "mossback",
    "firecracker"
   ],
   "size": "24 in fork length",
   "bag": "10 per day, but no more than 5 can be under 24 in fork length",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "bag": 10,
    "size": 24
   }
  },
  {
   "id": "white-seabass",
   "name": "White seabass",
   "group": "fish",
   "aka": [
    "white sea bass",
    "wsb",
    "croaker",
    "seabass"
   ],
   "size": "28 in total length (filleted or headed fish: alternate length, see CDFW)",
   "bag": "3 per day. Only 1 per day from March 15 to June 15",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "yearly": [
    {
     "from": "03-15",
     "to": "06-15",
     "state": "limited",
     "note": "Only 1 per day until June 15"
    }
   ],
   "facts": {
    "bag": 3,
    "size": 28
   }
  },
  {
   "id": "ca-halibut",
   "name": "California halibut",
   "group": "fish",
   "aka": [
    "halibut",
    "flatty",
    "flattie",
    "butt",
    "hali",
    "doormat"
   ],
   "size": "22 in total length",
   "bag": "5 per day (south of Point Sur)",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "bag": 5,
    "size": 22
   }
  },
  {
   "id": "kelp-bass",
   "name": "Kelp bass (calico)",
   "group": "fish",
   "aka": [
    "calico",
    "calico bass",
    "kelp bass",
    "bull bass",
    "bass",
    "cal"
   ],
   "size": "14 in total length, or 10 in alternate length",
   "bag": "5 per day of kelp, barred sand and spotted sand bass combined, with no more than 4 barred sand bass",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "bag": 5,
    "size": 14
   }
  },
  {
   "id": "barred-sand-bass",
   "name": "Barred sand bass",
   "group": "fish",
   "aka": [
    "sand bass",
    "sandies",
    "grumpy",
    "bsb"
   ],
   "size": "14 in total length, or 10 in alternate length",
   "bag": "Counts in the 5-bass combined limit, and no more than 4 of the 5 can be barred sand bass",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "size": 14
   }
  },
  {
   "id": "spotted-sand-bass",
   "name": "Spotted sand bass",
   "group": "fish",
   "aka": [
    "spotted bay bass",
    "spotty",
    "bay bass"
   ],
   "size": "14 in total length, or 10 in alternate length",
   "bag": "Counts in the 5-bass combined limit (kelp, barred and spotted sand bass)",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "size": 14
   }
  },
  {
   "id": "bluefin",
   "name": "Pacific bluefin tuna",
   "group": "fish",
   "aka": [
    "bluefin",
    "bft",
    "blue fin",
    "tuna",
    "cow"
   ],
   "size": "No size limit",
   "bag": "2 per day (in addition to the 20-fish total). Applies to all bluefin you have, wherever caught",
   "season": "Open all year",
   "notes": [
    "Multi-day trip and fillet-at-sea rules: see CDFW before you go."
   ],
   "src": "bluefin",
   "facts": {
    "bag": 2
   }
  },
  {
   "id": "yellowfin",
   "name": "Yellowfin and bigeye tuna",
   "group": "fish",
   "aka": [
    "yellowfin",
    "yft",
    "ahi",
    "bigeye",
    "tuna"
   ],
   "size": "No size limit",
   "bag": "10 per day",
   "season": "Open all year",
   "notes": [],
   "src": "finfish",
   "facts": {
    "bag": 10
   }
  },
  {
   "id": "albacore",
   "name": "Albacore",
   "group": "fish",
   "aka": [
    "albacore",
    "longfin",
    "tombo",
    "tuna"
   ],
   "size": "No size limit",
   "bag": "10 per day south of Point Conception (in addition to the 20-fish total)",
   "season": "Open all year",
   "notes": [],
   "src": "finfish",
   "facts": {
    "bag": 10
   }
  },
  {
   "id": "skipjack",
   "name": "Skipjack tuna",
   "group": "fish",
   "aka": [
    "skipjack",
    "skippy",
    "striped tuna"
   ],
   "size": "No size limit",
   "bag": "No limit",
   "season": "Open all year",
   "notes": [],
   "src": "finfish"
  },
  {
   "id": "bonito",
   "name": "Pacific bonito",
   "group": "fish",
   "aka": [
    "bonito",
    "boni",
    "bonehead"
   ],
   "size": "24 in fork length or 5 lb",
   "bag": "10 per day, and up to 5 of them can be smaller than the size limit",
   "season": "Open all year",
   "notes": [],
   "src": "finfish",
   "facts": {
    "bag": 10,
    "size": 24
   }
  },
  {
   "id": "dorado",
   "name": "Dorado (dolphinfish)",
   "group": "fish",
   "aka": [
    "dorado",
    "dolphin",
    "dolphinfish",
    "mahi",
    "mahi mahi",
    "bull",
    "dodo"
   ],
   "size": "No size limit",
   "bag": "10 per day (within the 20-fish total)",
   "season": "Open all year",
   "notes": [],
   "src": "finfish",
   "facts": {
    "bag": 10
   }
  },
  {
   "id": "marlin",
   "name": "Marlin (striped, blue, black)",
   "group": "fish",
   "aka": [
    "marlin",
    "striped marlin",
    "stripey",
    "billfish"
   ],
   "size": "No size limit",
   "bag": "1 per day",
   "season": "Open all year",
   "notes": [],
   "src": "finfish",
   "facts": {
    "bag": 1
   }
  },
  {
   "id": "swordfish",
   "name": "Swordfish",
   "group": "fish",
   "aka": [
    "swordfish",
    "broadbill",
    "sword"
   ],
   "size": "No size limit",
   "bag": "2 per day",
   "season": "Open all year",
   "notes": [],
   "src": "finfish",
   "facts": {
    "bag": 2
   }
  },
  {
   "id": "wahoo",
   "name": "Wahoo",
   "group": "fish",
   "aka": [
    "wahoo",
    "ono"
   ],
   "size": "No size limit",
   "bag": "General limit: 10 of this fish, within 20 fish total for the day",
   "season": "Open all year",
   "notes": [
    "No special rule for wahoo, so the general limit applies."
   ],
   "src": "finfish"
  },
  {
   "id": "sheephead",
   "name": "California sheephead",
   "group": "fish",
   "aka": [
    "sheephead",
    "sheepshead",
    "goat",
    "goatfish",
    "sheephead wrasse"
   ],
   "size": "12 in total length",
   "bag": "2 per day",
   "season": "Divers and shore anglers: all year. From a boat: March 1 to December 31",
   "notes": [],
   "src": "southern",
   "periods": [
    {
     "start": "2026-03-01",
     "end": "2026-12-31",
     "state": "open",
     "note": "Open from boats until Dec 31"
    }
   ],
   "after": {
    "state": "check",
    "note": "Boat season after Dec 31 not posted yet. Divers and shore anglers: open"
   },
   "before": {
    "state": "limited",
    "note": "Closed from boats. Divers and shore anglers: open"
   },
   "facts": {
    "bag": 2,
    "size": 12
   }
  },
  {
   "id": "whitefish",
   "name": "Ocean whitefish",
   "group": "fish",
   "aka": [
    "whitefish",
    "ocean whitefish",
    "blanquillo"
   ],
   "size": "No size limit",
   "bag": "10 per day (within the 20-fish total)",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "bag": 10
   }
  },
  {
   "id": "sculpin",
   "name": "California scorpionfish (sculpin)",
   "group": "fish",
   "aka": [
    "sculpin",
    "scorpionfish",
    "scorpion fish",
    "scorpy"
   ],
   "size": "No size limit",
   "bag": "5 per day",
   "season": "Open all year",
   "notes": [
    "Spines are venomous. Handle with care."
   ],
   "src": "southern",
   "facts": {
    "bag": 5
   }
  },
  {
   "id": "groupers",
   "name": "Groupers (except broomtail, gulf and giant sea bass)",
   "group": "fish",
   "aka": [
    "grouper"
   ],
   "size": "No size limit",
   "bag": "10 per day (within the 20-fish total)",
   "season": "Open all year",
   "notes": [],
   "src": "southern"
  },
  {
   "id": "corbina",
   "name": "California corbina",
   "group": "fish",
   "aka": [
    "corbina",
    "corvina",
    "surf fish"
   ],
   "size": "No size limit",
   "bag": "10 per day (within the 20-fish total)",
   "season": "Open all year",
   "notes": [],
   "src": "finfish"
  },
  {
   "id": "surfperch",
   "name": "Surfperch",
   "group": "fish",
   "aka": [
    "perch",
    "surf perch",
    "barred perch",
    "walleye",
    "rubberlip",
    "pile perch"
   ],
   "size": "Redtail surfperch: 10½ in total length. Others: no size limit",
   "bag": "20 per day combined, no more than 10 of any one kind. Shiner perch have their own limit of 20",
   "season": "Open all year",
   "notes": [],
   "src": "southern"
  },
  {
   "id": "grunion",
   "name": "California grunion",
   "group": "fish",
   "aka": [
    "grunion",
    "grunion run"
   ],
   "size": "No size limit",
   "bag": "30 per day",
   "season": "July 1 to March 31. Closed April through June",
   "notes": [
    "Hands only. No digging holes in the beach to trap them."
   ],
   "src": "southern",
   "yearly": [
    {
     "from": "04-01",
     "to": "06-30",
     "state": "closed",
     "note": "Closed until July 1 (spawning season)"
    }
   ],
   "facts": {
    "bag": 30
   }
  },
  {
   "id": "baitfish",
   "name": "Mackerel, sardines, anchovies and other baitfish",
   "group": "fish",
   "aka": [
    "mackerel",
    "chub mackerel",
    "jack mackerel",
    "spanish mackerel",
    "sardine",
    "anchovy",
    "sardines",
    "anchovies",
    "queenfish",
    "jacksmelt",
    "topsmelt",
    "smelt",
    "pompano",
    "butterfish",
    "round herring",
    "bait"
   ],
   "size": "No size limit",
   "bag": "No limit",
   "season": "Open all year",
   "notes": [
    "Pacific herring: 10 gallons per day."
   ],
   "src": "finfish"
  },
  {
   "id": "leopard-shark",
   "name": "Leopard shark",
   "group": "fish",
   "aka": [
    "leopard shark",
    "leopard",
    "shark"
   ],
   "size": "36 in total length",
   "bag": "3 per day",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "bag": 3,
    "size": 36
   }
  },
  {
   "id": "mako-thresher-blue",
   "name": "Mako, thresher and blue shark",
   "group": "fish",
   "aka": [
    "mako",
    "shortfin mako",
    "thresher",
    "blue shark",
    "blue dog",
    "shark"
   ],
   "size": "No size limit",
   "bag": "2 per day of each kind",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "bag": 2
   }
  },
  {
   "id": "sevengill",
   "name": "Sixgill and sevengill shark",
   "group": "fish",
   "aka": [
    "sevengill",
    "sixgill",
    "broadnose sevengill",
    "cow shark",
    "shark"
   ],
   "size": "No size limit",
   "bag": "1 per day of each kind",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "bag": 1
   }
  },
  {
   "id": "soupfin",
   "name": "Soupfin shark",
   "group": "fish",
   "aka": [
    "soupfin",
    "tope",
    "school shark",
    "shark"
   ],
   "size": "No size limit",
   "bag": "1 per day",
   "season": "Open all year",
   "notes": [],
   "src": "finfish",
   "facts": {
    "bag": 1
   }
  },
  {
   "id": "skates-dogfish",
   "name": "Skates and spiny dogfish",
   "group": "fish",
   "aka": [
    "skate",
    "ray",
    "dogfish",
    "spiny dogfish"
   ],
   "size": "No size limit",
   "bag": "10 per day (within the 20-fish total)",
   "season": "Open all year",
   "notes": [],
   "src": "finfish"
  },
  {
   "id": "flatfish",
   "name": "Sanddabs and soles",
   "group": "fish",
   "aka": [
    "sanddab",
    "sand dab",
    "sole",
    "petrale",
    "flatfish",
    "starry flounder",
    "turbot"
   ],
   "size": "No size limit",
   "bag": "Sanddabs, petrale sole and starry flounder: no limit. Other soles: 10 per day",
   "season": "Open all year, all depths",
   "notes": [],
   "src": "southern"
  },
  {
   "id": "rockfish-shelf",
   "name": "Rockfish: deep and shelf (reds, vermilion, bocaccio and more)",
   "group": "rockfish",
   "aka": [
    "rockfish",
    "rock cod",
    "rockcod",
    "reds",
    "red snapper",
    "vermilion",
    "bocaccio",
    "salmon grouper",
    "chilipepper",
    "starry",
    "flag",
    "greenspotted",
    "boccacio",
    "deep drop",
    "bottom fish"
   ],
   "size": "No size limit",
   "bag": "10 per day of all rockfish, cabezon and greenlings combined",
   "season": "Jan–Mar closed · Apr–Jun all depths · Jul–Sep inside 50 fathoms · Oct–Dec outside 50 fathoms (2026)",
   "notes": [
    "Shore anglers and spear divers don't have to follow the season and depth rules.",
    "Vermilion (and sunset) rockfish: only 2 of your 10. Canary: only 2.",
    "Cowcod, yelloweye, quillback and bronzespotted rockfish: none allowed."
   ],
   "src": "groundfish",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-03-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    },
    {
     "start": "2026-04-01",
     "end": "2026-06-30",
     "state": "open",
     "note": "Open, all depths"
    },
    {
     "start": "2026-07-01",
     "end": "2026-09-30",
     "state": "limited",
     "note": "Open inside 50 fathoms (300 ft) only"
    },
    {
     "start": "2026-10-01",
     "end": "2026-12-31",
     "state": "limited",
     "note": "Open outside (deeper than) 50 fathoms only"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 rockfish season not posted yet. Check CDFW"
   },
   "facts": {
    "bag": 10
   }
  },
  {
   "id": "rockfish-near",
   "name": "Rockfish: nearshore (grass, gopher, kelp, copper, brown and more)",
   "group": "rockfish",
   "aka": [
    "nearshore rockfish",
    "grass rockfish",
    "gopher",
    "kelp rockfish",
    "copper",
    "brown rockfish",
    "treefish",
    "china rockfish",
    "calico rockfish",
    "black and yellow",
    "olive",
    "blue rockfish",
    "black rockfish",
    "rock cod",
    "rockfish"
   ],
   "size": "No size limit",
   "bag": "10 per day of all rockfish, cabezon and greenlings combined. Copper rockfish: only 1 of the 10",
   "season": "Jan–Mar closed · Apr–Jun all depths · Jul–Sep inside 50 fathoms · Oct–Dec closed (2026)",
   "notes": [
    "Shore anglers and spear divers don't have to follow the season and depth rules."
   ],
   "src": "groundfish",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-03-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    },
    {
     "start": "2026-04-01",
     "end": "2026-06-30",
     "state": "open",
     "note": "Open, all depths"
    },
    {
     "start": "2026-07-01",
     "end": "2026-09-30",
     "state": "limited",
     "note": "Open inside 50 fathoms (300 ft) only"
    },
    {
     "start": "2026-10-01",
     "end": "2026-12-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 rockfish season not posted yet. Check CDFW"
   },
   "facts": {
    "bag": 10
   }
  },
  {
   "id": "vermilion",
   "name": "Vermilion and sunset rockfish",
   "group": "rockfish",
   "aka": [
    "vermilion",
    "vermillion",
    "reds",
    "red snapper",
    "sunset rockfish"
   ],
   "size": "No size limit",
   "bag": "2 per day, counted in the 10-rockfish limit",
   "season": "Same as deep and shelf rockfish",
   "notes": [
    "Shore anglers and spear divers don't have to follow the season and depth rules."
   ],
   "src": "groundfish",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-03-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    },
    {
     "start": "2026-04-01",
     "end": "2026-06-30",
     "state": "open",
     "note": "Open, all depths"
    },
    {
     "start": "2026-07-01",
     "end": "2026-09-30",
     "state": "limited",
     "note": "Open inside 50 fathoms (300 ft) only"
    },
    {
     "start": "2026-10-01",
     "end": "2026-12-31",
     "state": "limited",
     "note": "Open outside (deeper than) 50 fathoms only"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 rockfish season not posted yet. Check CDFW"
   },
   "facts": {
    "bag": 2
   }
  },
  {
   "id": "copper",
   "name": "Copper rockfish",
   "group": "rockfish",
   "aka": [
    "copper",
    "copper rockfish",
    "whitebelly"
   ],
   "size": "No size limit",
   "bag": "1 per day, counted in the 10-rockfish limit",
   "season": "Same as nearshore rockfish",
   "notes": [
    "Shore anglers and spear divers don't have to follow the season and depth rules."
   ],
   "src": "groundfish",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-03-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    },
    {
     "start": "2026-04-01",
     "end": "2026-06-30",
     "state": "open",
     "note": "Open, all depths"
    },
    {
     "start": "2026-07-01",
     "end": "2026-09-30",
     "state": "limited",
     "note": "Open inside 50 fathoms (300 ft) only"
    },
    {
     "start": "2026-10-01",
     "end": "2026-12-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 rockfish season not posted yet. Check CDFW"
   },
   "facts": {
    "bag": 1
   }
  },
  {
   "id": "canary",
   "name": "Canary rockfish",
   "group": "rockfish",
   "aka": [
    "canary",
    "canary rockfish",
    "orange rockfish"
   ],
   "size": "No size limit",
   "bag": "2 per day, counted in the 10-rockfish limit",
   "season": "Same as deep and shelf rockfish",
   "notes": [
    "Shore anglers and spear divers don't have to follow the season and depth rules."
   ],
   "src": "groundfish",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-03-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    },
    {
     "start": "2026-04-01",
     "end": "2026-06-30",
     "state": "open",
     "note": "Open, all depths"
    },
    {
     "start": "2026-07-01",
     "end": "2026-09-30",
     "state": "limited",
     "note": "Open inside 50 fathoms (300 ft) only"
    },
    {
     "start": "2026-10-01",
     "end": "2026-12-31",
     "state": "limited",
     "note": "Open outside (deeper than) 50 fathoms only"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 rockfish season not posted yet. Check CDFW"
   },
   "facts": {
    "bag": 2
   }
  },
  {
   "id": "lingcod",
   "name": "Lingcod",
   "group": "rockfish",
   "aka": [
    "lingcod",
    "ling",
    "ling cod",
    "lings",
    "snakehead"
   ],
   "size": "22 in total length",
   "bag": "2 per day",
   "season": "Same as deep and shelf rockfish",
   "notes": [
    "Shore anglers and spear divers don't have to follow the season and depth rules."
   ],
   "src": "groundfish",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-03-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    },
    {
     "start": "2026-04-01",
     "end": "2026-06-30",
     "state": "open",
     "note": "Open, all depths"
    },
    {
     "start": "2026-07-01",
     "end": "2026-09-30",
     "state": "limited",
     "note": "Open inside 50 fathoms (300 ft) only"
    },
    {
     "start": "2026-10-01",
     "end": "2026-12-31",
     "state": "limited",
     "note": "Open outside (deeper than) 50 fathoms only"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 rockfish season not posted yet. Check CDFW"
   },
   "facts": {
    "bag": 2,
    "size": 22
   }
  },
  {
   "id": "cabezon",
   "name": "Cabezon",
   "group": "rockfish",
   "aka": [
    "cabezon",
    "cabbie",
    "scorpion"
   ],
   "size": "No size limit",
   "bag": "Counted in the 10 rockfish, cabezon and greenlings limit",
   "season": "Same as nearshore rockfish",
   "notes": [
    "Shore anglers and spear divers don't have to follow the season and depth rules."
   ],
   "src": "groundfish",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-03-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    },
    {
     "start": "2026-04-01",
     "end": "2026-06-30",
     "state": "open",
     "note": "Open, all depths"
    },
    {
     "start": "2026-07-01",
     "end": "2026-09-30",
     "state": "limited",
     "note": "Open inside 50 fathoms (300 ft) only"
    },
    {
     "start": "2026-10-01",
     "end": "2026-12-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 rockfish season not posted yet. Check CDFW"
   }
  },
  {
   "id": "greenling",
   "name": "Kelp and rock greenling",
   "group": "rockfish",
   "aka": [
    "greenling",
    "kelp greenling",
    "rock greenling",
    "sea trout"
   ],
   "size": "No size limit",
   "bag": "Counted in the 10 rockfish, cabezon and greenlings limit",
   "season": "Same as nearshore rockfish",
   "notes": [
    "Shore anglers and spear divers don't have to follow the season and depth rules."
   ],
   "src": "groundfish",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-03-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    },
    {
     "start": "2026-04-01",
     "end": "2026-06-30",
     "state": "open",
     "note": "Open, all depths"
    },
    {
     "start": "2026-07-01",
     "end": "2026-09-30",
     "state": "limited",
     "note": "Open inside 50 fathoms (300 ft) only"
    },
    {
     "start": "2026-10-01",
     "end": "2026-12-31",
     "state": "closed",
     "note": "Closed. You can't even have them on the boat"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 rockfish season not posted yet. Check CDFW"
   }
  },
  {
   "id": "lobster",
   "name": "California spiny lobster",
   "group": "shell",
   "aka": [
    "lobster",
    "bug",
    "bugs",
    "spiny lobster",
    "langosta",
    "crawfish",
    "hoop net",
    "hooping"
   ],
   "size": "3¼ in carapace (back edge of the eye socket to the back edge of the body shell, along the middle)",
   "bag": "7 per day",
   "season": "6 p.m. on the Friday before the first Wednesday in October, until the first Wednesday after March 15",
   "notes": [
    "Spiny Lobster Report Card needed for everyone, including kids under 16.",
    "Hoop nets: 5 per person, 10 per boat. Check them at least every 2 hours.",
    "South of Point Arguello, every hoop net needs a surface buoy with your GO ID.",
    "No spears for lobster."
   ],
   "src": "southern",
   "rule": "lobster",
   "facts": {
    "bag": 7
   }
  },
  {
   "id": "rock-crab",
   "name": "Rock crab (red, yellow, brown)",
   "group": "shell",
   "aka": [
    "rock crab",
    "red crab",
    "yellow crab",
    "brown crab",
    "cancer crab",
    "crab"
   ],
   "size": "4 in across the shell",
   "bag": "35 per day",
   "season": "Open all year",
   "notes": [],
   "src": "southern",
   "facts": {
    "bag": 35,
    "size": 4
   }
  },
  {
   "id": "sand-crab",
   "name": "Sand crab",
   "group": "shell",
   "aka": [
    "sand crab",
    "mole crab",
    "sand flea",
    "bait"
   ],
   "size": "No size limit",
   "bag": "50 per day",
   "season": "Open all year",
   "notes": [],
   "src": "inverts",
   "facts": {
    "bag": 50
   }
  },
  {
   "id": "other-crab",
   "name": "Other crabs (sheep crab, kelp crab and more)",
   "group": "shell",
   "aka": [
    "sheep crab",
    "spider crab",
    "kelp crab",
    "shore crab",
    "crab"
   ],
   "size": "No size limit",
   "bag": "35 per day",
   "season": "Open all year",
   "notes": [],
   "src": "inverts"
  },
  {
   "id": "pismo",
   "name": "Pismo clam",
   "group": "shell",
   "aka": [
    "pismo",
    "pismo clam",
    "clam",
    "clamming"
   ],
   "size": "4½ in across the shell (San Luis Obispo County and south)",
   "bag": "10 per day",
   "season": "Open all year",
   "notes": [
    "Dig only from ½ hour before sunrise to ½ hour after sunset.",
    "Clam preserves are closed. Check posted signs on the beach."
   ],
   "src": "inverts",
   "facts": {
    "bag": 10
   }
  },
  {
   "id": "littleneck",
   "name": "Littleneck clams, chiones and cockles",
   "group": "shell",
   "aka": [
    "littleneck",
    "chione",
    "cockle",
    "quahog",
    "clam"
   ],
   "size": "1½ in across the shell",
   "bag": "50 per day combined",
   "season": "Open all year",
   "notes": [
    "Dig only from ½ hour before sunrise to ½ hour after sunset."
   ],
   "src": "inverts"
  },
  {
   "id": "gaper",
   "name": "Gaper and Washington clams",
   "group": "shell",
   "aka": [
    "gaper",
    "horseneck",
    "washington clam",
    "butter clam",
    "clam"
   ],
   "size": "No size limit",
   "bag": "10 per day of each kind",
   "season": "Open all year",
   "notes": [],
   "src": "inverts"
  },
  {
   "id": "geoduck",
   "name": "Geoduck",
   "group": "shell",
   "aka": [
    "geoduck",
    "gooey duck",
    "clam"
   ],
   "size": "No size limit",
   "bag": "3 per day",
   "season": "Open all year",
   "notes": [],
   "src": "inverts",
   "facts": {
    "bag": 3
   }
  },
  {
   "id": "mussels",
   "name": "Mussels",
   "group": "shell",
   "aka": [
    "mussel",
    "mussels",
    "sea mussel",
    "bay mussel"
   ],
   "size": "No size limit",
   "bag": "10 lb in the shell per day",
   "season": "Open all year",
   "notes": [
    "Health quarantine usually May 1 to October 31: don't eat them then (bait only).",
    "Don't eat mussels or clams from the Northern Channel Islands.",
    "Shellfish poisoning hotline: 1-800-553-4133."
   ],
   "src": "southern"
  },
  {
   "id": "rock-scallop",
   "name": "Rock scallop",
   "group": "shell",
   "aka": [
    "rock scallop",
    "scallop",
    "purple hinge"
   ],
   "size": "No size limit",
   "bag": "10 per day",
   "season": "Open all year",
   "notes": [],
   "src": "inverts",
   "facts": {
    "bag": 10
   }
  },
  {
   "id": "octopus",
   "name": "Octopus",
   "group": "shell",
   "aka": [
    "octopus",
    "octo",
    "pulpo"
   ],
   "size": "No size limit",
   "bag": "35 per day",
   "season": "Open all year",
   "notes": [],
   "src": "inverts",
   "facts": {
    "bag": 35
   }
  },
  {
   "id": "urchin",
   "name": "Sea urchins (red and purple)",
   "group": "shell",
   "aka": [
    "urchin",
    "sea urchin",
    "uni",
    "red urchin",
    "purple urchin"
   ],
   "size": "No size limit",
   "bag": "35 per day",
   "season": "Open all year",
   "notes": [],
   "src": "inverts",
   "facts": {
    "bag": 35
   }
  },
  {
   "id": "squid",
   "name": "Squid (market and jumbo)",
   "group": "shell",
   "aka": [
    "squid",
    "calamari",
    "humboldt",
    "jumbo squid"
   ],
   "size": "No size limit",
   "bag": "No limit",
   "season": "Open all year",
   "notes": [],
   "src": "inverts"
  },
  {
   "id": "ghost-shrimp",
   "name": "Ghost and blue mud shrimp",
   "group": "shell",
   "aka": [
    "ghost shrimp",
    "mud shrimp",
    "bait shrimp",
    "shrimp"
   ],
   "size": "No size limit",
   "bag": "50 per day combined",
   "season": "Open all year",
   "notes": [],
   "src": "inverts"
  },
  {
   "id": "other-shrimp",
   "name": "Other shrimp and prawns",
   "group": "shell",
   "aka": [
    "shrimp",
    "prawn",
    "spot prawn",
    "ridgeback"
   ],
   "size": "No size limit",
   "bag": "35 per day",
   "season": "Open all year",
   "notes": [],
   "src": "inverts"
  },
  {
   "id": "snails",
   "name": "Turban snails, moon snails and Kellet's whelk",
   "group": "shell",
   "aka": [
    "snail",
    "turban",
    "moon snail",
    "whelk",
    "kellets whelk"
   ],
   "size": "No size limit",
   "bag": "Turban snails: 35. Moon snails: 5. Kellet's whelk: 35 (July 1 to the first Wednesday after March 15)",
   "season": "Open all year",
   "notes": [],
   "src": "inverts"
  },
  {
   "id": "other-inverts",
   "name": "Limpets, oysters and other shellfish",
   "group": "shell",
   "aka": [
    "limpet",
    "oyster",
    "sand dollar",
    "worm",
    "other"
   ],
   "size": "No size limit",
   "bag": "35 per day of each kind",
   "season": "Open all year",
   "notes": [],
   "src": "inverts"
  },
  {
   "id": "tidepools",
   "name": "Tidepool rule",
   "group": "shell",
   "aka": [
    "tidepool",
    "tide pool",
    "sea star",
    "starfish",
    "anemone",
    "sea hare",
    "cucumber",
    "sea cucumber"
   ],
   "size": "—",
   "bag": "Nothing may be taken in tidepools or from the high-tide line out to 1,000 ft past the low-tide line, except the kinds listed in the regulations",
   "season": "All year",
   "notes": [],
   "src": "inverts"
  },
  {
   "id": "giant-sea-bass",
   "name": "Giant (black) sea bass",
   "group": "prohibited",
   "aka": [
    "giant sea bass",
    "black sea bass",
    "gsb",
    "black seabass",
    "jewfish"
   ],
   "size": "—",
   "bag": "None. Take is not allowed",
   "season": "Closed all year",
   "notes": [
    "Protected. Release it right away."
   ],
   "src": "southern",
   "status": "prohibited"
  },
  {
   "id": "garibaldi",
   "name": "Garibaldi",
   "group": "prohibited",
   "aka": [
    "garibaldi",
    "state fish",
    "orange fish"
   ],
   "size": "—",
   "bag": "None. Take is not allowed",
   "season": "Closed all year",
   "notes": [
    "California's state marine fish. Protected."
   ],
   "src": "finfish",
   "status": "prohibited"
  },
  {
   "id": "white-shark",
   "name": "White shark",
   "group": "prohibited",
   "aka": [
    "great white",
    "white shark",
    "gw"
   ],
   "size": "—",
   "bag": "None. Take is not allowed",
   "season": "Closed all year",
   "notes": [
    "You may not catch or keep one. Release it right away."
   ],
   "src": "southern",
   "status": "prohibited"
  },
  {
   "id": "broomtail-gulf",
   "name": "Broomtail and gulf grouper",
   "group": "prohibited",
   "aka": [
    "broomtail",
    "gulf grouper",
    "grouper"
   ],
   "size": "—",
   "bag": "None. Take is not allowed",
   "season": "Closed all year",
   "notes": [
    "Protected."
   ],
   "src": "southern",
   "status": "prohibited"
  },
  {
   "id": "abalone",
   "name": "Abalone (all kinds)",
   "group": "prohibited",
   "aka": [
    "abalone",
    "ab",
    "abs",
    "red abalone",
    "green abalone"
   ],
   "size": "—",
   "bag": "None. Take is not allowed",
   "season": "Closed all year",
   "notes": [
    "No abalone may be taken in Southern California at any time."
   ],
   "src": "southern",
   "status": "prohibited"
  },
  {
   "id": "bay-scallop",
   "name": "Bay (speckled) scallop",
   "group": "prohibited",
   "aka": [
    "bay scallop",
    "speckled scallop",
    "scallop"
   ],
   "size": "—",
   "bag": "None. Take is not allowed",
   "season": "Closed all year",
   "notes": [
    "You may not take or have them."
   ],
   "src": "inverts",
   "status": "prohibited"
  },
  {
   "id": "no-keep-rockfish",
   "name": "Cowcod, yelloweye, quillback and bronzespotted rockfish",
   "group": "prohibited",
   "aka": [
    "cowcod",
    "yelloweye",
    "quillback",
    "bronzespotted",
    "rockfish"
   ],
   "size": "—",
   "bag": "None. Take is not allowed",
   "season": "Closed all year",
   "notes": [
    "Zero allowed at any time. Use a descending device to release them."
   ],
   "src": "groundfish",
   "status": "prohibited"
  },
  {
   "id": "salmon",
   "name": "Ocean salmon",
   "group": "prohibited",
   "aka": [
    "salmon",
    "king salmon",
    "chinook",
    "coho",
    "silver salmon"
   ],
   "size": "—",
   "bag": "None while closed",
   "season": "Closed for the rest of 2026 (Pigeon Point to Mexico)",
   "notes": [
    "Coho (silver) salmon are never allowed."
   ],
   "src": "southern",
   "periods": [
    {
     "start": "2026-01-01",
     "end": "2026-12-31",
     "state": "closed",
     "note": "Closed for the rest of 2026"
    }
   ],
   "after": {
    "state": "check",
    "note": "2027 dates come after the April 2027 review"
   }
  },
  {
   "id": "general-limit",
   "name": "General daily limit",
   "group": "general",
   "aka": [
    "general",
    "bag limit",
    "limit",
    "20 fish",
    "daily limit",
    "possession"
   ],
   "size": "—",
   "bag": "20 fish total per person per day, with no more than 10 of any one kind, unless that fish has its own rule",
   "season": "—",
   "notes": [],
   "src": "finfish"
  },
  {
   "id": "measure",
   "name": "How fish are measured",
   "group": "general",
   "aka": [
    "measure",
    "measuring",
    "total length",
    "fork length",
    "alternate length",
    "tl",
    "fl"
   ],
   "size": "—",
   "bag": "Total length: tip of the head to the end of the tail. Fork length: tip of the head to the fork (middle) of the tail. Alternate length: for fish that are filleted or have the head off. See CDFW for each fish",
   "season": "—",
   "notes": [],
   "src": "southern"
  },
  {
   "id": "license",
   "name": "Fishing license and report cards",
   "group": "general",
   "aka": [
    "license",
    "licence",
    "report card",
    "lobster card",
    "go id",
    "fishing license"
   ],
   "size": "—",
   "bag": "Everyone 16 and older needs a California sport fishing license to fish in the ocean (except from a public pier). The Spiny Lobster Report Card is needed for lobster at every age",
   "season": "—",
   "notes": [],
   "src": "southern"
  },
  {
   "id": "mpa",
   "name": "Marine Protected Areas (MPAs)",
   "group": "general",
   "aka": [
    "mpa",
    "marine protected area",
    "reserve",
    "no take",
    "closed area"
   ],
   "size": "—",
   "bag": "Fishing is limited or not allowed in MPAs. Turn on the MPA layer on the map to see them and what's allowed in each",
   "season": "—",
   "notes": [],
   "src": "southern"
  }
 ]
};
