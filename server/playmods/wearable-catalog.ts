/**
 * Exact name AND slot matches against this repository's Creative items.dat.
 * Gameplay classifications from https://growtopiawiki.com/w/Mods/ ; those
 * pages are CC BY-SA and describe game facts. This is not a visual-effect map.
 * Conditional/mode-dependent behaviours and missing items remain unsupported.
 */
export const PUNCH_DAMAGE_IDS: ReadonlySet<number> = new Set([
  98, // Pickaxe
  734, // Cybernetic Arm
  900, // Dragon Hand
  930, // Death Ray
  1378, // Ice Dragon Hand
  1438, // Golden Pickaxe
  1484, // Atomic Shadow Scythe
  1576, // Fiesta Dragon
  1708, // Explorer's Shovel
  1748, // Flamethrower
  1780, // Legendbot-009
  1782, // Dragon of Legend
  1836, // Diamond Flashaxe
  1874, // Ring Of Force
  1956, // Chaos Cursed Wand
  1998, // Skeletal Dragon Claw
  2212, // Black Crystal Dragon
  2218, // Mighty Snow Rod
  2386, // Heavenly Scythe
  2388, // Heartbreaker Hammer
  2450, // Diamond Dragon
  2572, // Flame Scythe
  2592, // Legendary Katana
  2754, // Demonic Arm
  2854, // Phoenix Pacifier
  2910, // Emerald Staff
  3166, // Pet Slime
  3168, // Strawberry Slime
  3214, // Axe Of Winter
  3418, // Serpent Staff
  3588, // Climbing Picks
  3686, // Toy Lock-Bot
  4166, // Death's Scythe
  4170, // Logarithmic Wheel
  4590, // Zraei's Dragoscarf
  4956, // Emerald Pickaxe
  4996, // Burning Hands
  5424, // Winter Frost Bow
  6240, // Exquisite Hammer
  6260, // Amulet of Force
  6312, // Phoenix Sword
  6358, // Startopian Empire - Combat Rifle
  6368, // Greezak Horde - Shoulder Cannon
  6756, // Scepter of the Honor Guard
  6804, // Bubble Gun
  6892, // Sorcerer's Tunic of Mystery
  6966, // Riding Bull
  7044, // Jade Crescent Axe
  7098, // Apocalypse Scythe
  7216, // Mad Hatter
  7392, // Mage's Orb
  7396, // Snowflake Eyes
  7568, // Hovernator Drone - White
  7570, // Hovernator Drone - Black
  7572, // Hovernator Drone - Red
  7574, // Hovernator Drone - Golden
  7586, // Sonic Buster Sword
  7650, // Mjolnir
  7826, // Heartstaff
  7828, // Golden Heartstaff
  7830, // Heartsword
  7832, // Golden Heartsword
  7912, // War Hammers of Darkness
  7940, // Flaming Boxing Gloves
  7950, // Ionic Pulse Cannon Tank
  8366, // Extra Undead Arms
  8372, // Giant Eye Head
  8432, // Galactic Destructor - Green
  8434, // Galactic Destructor - Purple
  8436, // Galactic Destructor - Red
  8438, // Galactic Destructor - Blue
  8492, // Wormtouch
  8604, // Crab Claw & Shield
  8814, // Slithering Serpent Hair
  8816, // Astro Shades - Red
  8818, // Astro Shades - Orange
  8820, // Astro Shades - Purple
  8822, // Astro Shades - Green
  8942, // Dual Crescent Blade
  8944, // Sun Blade
  8946, // Storm Breaker
  9006, // Spirit of Anubis
  9032, // Scythe of the Underworld
  9058, // Cursed Katana
  9082, // Rocket-Powered Warhammer
  9176, // Armored WinterBot - Fists
  9194, // Hammer Of Winter
  9254, // Euphoric Dragon
  9272, // Draconic Claw
  9316, // Beefy Biceps
  9326, // Golden Heartthrob Helm
  9340, // Datemaster's Rose
  9342, // Datemaster's Bling
  9376, // Mining Mech
  9410, // Radiant Doom Staff
  9462, // Boastful Brawler Hair
  9464, // Powerful Ponytail Hair
  9606, // Doomsday Warhammer
  9654, // Pineapple Superhero
  9698, // Arm Blaster
  9714, // My Pet Sputnik
  9716, // Crystal Infused Sword
  9734, // Starfish Leash
  9738, // Staff of the Deep
  9758, // Neptune's Trident
  10048, // Tactical Stealth Espionage Device
  10050, // Really Dangerous Pet Llama
  10064, // Capuchin Leash
  10128, // Mechanical Butler
  10130, // Sun Shooter Bow
  10166, // Haunted Jack O' Lantern
  10232, // Reanimated Howly Hat
  10278, // Torch of Enlightenment
  10330, // Shadow Crown
  10388, // Swordfish Sword
  10402, // Christmas Tree Sword
  10406, // Staff of Deepest Winter
  10494, // Walktopian
  10506, // Spruce Goose
  10578, // Mystic Battle Lance
  10618, // Perilous Pirate Ship
  10652, // Love Charged Hands
  10676, // Shamrock Shuriken
  10686, // Shady Agent Shades
  10694, // Mini Minokawa
  10714, // Steampunk Arm
  10722, // Bunny Ear Magnifying Glass
  10780, // Giving Growaxe
  10802, // Sombrero Assault
  10888, // Giant Pineapple Pizza Paddle
  10894, // Pineapple Shoulder Cannon
  10922, // Pegasus Lance
  10994, // Unknown Space Pet
  10996, // Space Rover
  11006, // Soul Scythe
  11046, // Hydro Cannon
  11076, // Ambu-Lance
  11084, // Beowulf's Blade
  11116, // Crystal Crown
  11118, // Sonic Buster Katana
  11120, // Primordial Jade Lance
  11140, // Legendary Destroyer
  11244, // Crystal of Hoa
  11290, // Robot Lord Cape
  11298, // Sakura's Revenge
  11306, // Clam Cruiser
  11308, // Royal Clam Cruiser
  11314, // Cauldron Cannon
  11316, // Skull of Burning Horrors
  11358, // Super Slapshot Stick
  11384, // Matrix Visor
  11458, // Santa's Super Sack
  11464, // Ice Dragon Scythe
  11482, // Cloak of S'mores
  11536, // Beat Box Mask
  11562, // Pet Blood Dragon
  11626, // Mythic Tiger Crown
  11630, // Monkey Warrior's Staff
  11672, // Stained Glass Crown
  11674, // Fancy Flute
  11704, // Alpha Wolf
  11706, // Royal Alpha Wolf
  11716, // Mallet of Sucelles
  11764, // Edison, The Lightbulb
  11872, // Comida Crusher
  11876, // Serpent Shoulders
  11994, // Pineapple of Locksley
  12016, // Gwyn's Heirloom
  12018, // Rok's Fists
  12022, // Mek'leth
  12052, // Drednok's Chestplate
  12102, // Zero's Arms
  12176, // Poppin' Popsicle Pickaxe
  12230, // Ghost Pirate Scimitar
  12232, // Neon Manta Ray
  12238, // Cruisin' Crab
  12242, // bllade's Celestius
  12284, // Pet Royal Guard
  12286, // Pet Pink Crocodile
  12342, // Mageblade
  12356, // Garuda Battle Axe
  12368, // Strange Eddie Axe
  12374, // Mighty Legend Gauntlets
  12420, // Skull Surged Veins
  12628, // Shattered Spear
  12658, // Fist of Vengeance
  12850, // Growtronic Food Replicator
  12862, // Scepter of Shadows
  12880, // Freezing Fists
  12884, // Candle Crown
  12886, // Icicle Lance
  12958, // Infinity Crown
  12990, // Disco Fever
  12992, // Lightning Guitar
  12994, // Rave Cap
  13050, // Mythic Vermillion Crown
  13060, // Lunar Drum
  13114, // Stained Glass Scepter
  13116, // Crimson Thief Mask
  13118, // Bear That Cares
  13136, // Golden Stained Glass Scepter
  13190, // Dagger of Time
]);

export const PUNCH_RANGE_IDS: ReadonlySet<number> = new Set([
  138, // Cyclopean Visor
  366, // Heartbow
  1464, // Golden Heartbow
  1542, // Battle Trout
  1676, // Squirt Gun
  1780, // Legendbot-009
  1782, // Dragon of Legend
  2266, // Crystal Glaive
  2450, // Diamond Dragon
  2476, // Burning Eyes
  2592, // Legendary Katana
  2720, // Electric Bow
  2754, // Demonic Arm
  2802, // Poseidon's Trident
  2854, // Phoenix Pacifier
  2976, // Cybernetic Eye
  3066, // Fire Hose
  3124, // Soul Orb
  3476, // Spring Bouquet
  3678, // Thinking Cap
  3680, // Phlogiston
  4126, // Stone Spear
  4136, // Heatbow
  4278, // Yo-Yo
  4464, // AK-8087
  4778, // Adventurer's Whip
  5206, // Cloak of Falling Waters
  5424, // Winter Frost Bow
  5456, // Silverstar Bow
  6110, // Pineapple Spear
  6754, // Squirrel King
  7088, // Ezio's Armguards
  7142, // Tamed Looming Triffid
  7392, // Mage's Orb
  7504, // Super Squirt Rifle 500
  7646, // Tyr's Spear
  7660, // Super Party Launcher
  7736, // Dragon Knight's Spear
  8006, // Hellfire Horns - Black
  8008, // Hellfire Horns - Blue
  8010, // Hellfire Horns - Orange
  8012, // Hellfire Horns - Ruby
  8306, // Legendary Comet Hair
  8432, // Galactic Destructor - Green
  8434, // Galactic Destructor - Purple
  8436, // Galactic Destructor - Red
  8438, // Galactic Destructor - Blue
  8464, // Clockwork Eyes
  8894, // Panda Leash
  8912, // Scarecrow Pet
  8950, // Sniper Rifle
  8960, // Spring-Loaded Fists
  10046, // Growboy
  10052, // Eldritch Crossbow
  10128, // Mechanical Butler
  10130, // Sun Shooter Bow
  10250, // Ultra Sportsball Bat
  10260, // All You Can Eat Bib
  10330, // Shadow Crown
  10336, // Black Burning Eyes
  10392, // Water Gun Hat
  10442, // Winter Light Launcher
  10586, // Oxen Battle Helm
  10626, // Rose Rifle
  10670, // Bow of the Rainbow
  10680, // Finias' Red Javelin
  10694, // Mini Minokawa
  10724, // Lil Growpeep's Baaaa Blaster
  10748, // One Winged Angel
  10800, // Cactus Cannon
  10804, // Waay Chivo Mask
  10886, // Pineapple Chakram
  10952, // Space Badger
  10954, // Space Mouse
  10956, // Space Dog
  10958, // Space Pig
  10960, // Space Rabbit
  10998, // Suspicious Weather Balloon
  11000, // Channel G News Van
  11020, // Dark Assassin's Armguards
  11052, // Super Duper Ice Cream Scooper
  11078, // Cute Mutant Wonky
  11080, // Cute Mutant Plonky
  11082, // Cute Mutant Boogle
  11158, // Zodiac Ring
  11162, // Finger Gun
  11240, // Seed Gatling Gun
  11248, // Staff of S'mores
  11250, // Harvest Jade Hat
  11284, // Paper Wasp Pet
  11312, // Spider Sniper
  11320, // Waay Chivo Skull
  11324, // Pharaoh's Pendant
  11326, // Ferryman of the Underworld
  11380, // Black Bow of the Rainbow
  11384, // Matrix Visor
  11438, // Digital Bow
  11440, // Mystic Bow
  11442, // Royal Mystic Bow
  11460, // Snow Cone Pet
  11466, // Aura Antlers
  11506, // Mask of The Dragon
  11508, // Royal Mask of The Dragon
  11534, // Growby
  11542, // Neon Party Yo-Yo
  11546, // Mood Mask
  11548, // Guardian Armor
  11552, // Royal Guardian Armor
  11554, // Bodvar
  11556, // Val
  11558, // Sam Fisher
  11560, // Ezio
  11594, // Riding Rabbid
  11622, // Draconic Soul Cannon
  11672, // Stained Glass Crown
  11710, // Mr. Grownopoly's Suitcase
  11718, // Harp of Aibell
  11720, // Eye of Balor
  11762, // Growing Guardian Gauntlets
  11768, // Fish Tank Head
  11786, // Soft-boiled Scepter
  11814, // Rabbit Top Hat
  11876, // Serpent Shoulders
  11882, // Neurovision
  11884, // Royal Neurovision
  11990, // Baby Guzzler
  11994, // Pineapple of Locksley
  12000, // Pineapple Warrior Charm
  12014, // Dal's Phasers
  12020, // Jankom Pog's Multi-Mitt
  12024, // Mine Laser Drill
  12052, // Drednok's Chestplate
  12172, // Ethereal Chains
  12180, // Great Ball of Fire
  12184, // Pearl Bracelet
  12188, // Neptune's Crown
  12228, // Ghost Pirate Head
  12240, // Oceanaura
  12246, // Staff of Gale
  12248, // Royal Staff of Gale
  12288, // Pet Punching Ghost
  12296, // Braided Golden Hair
  12300, // Arm Blades
  12302, // Lightning Horns
  12308, // Eldritch Eyes
  12382, // Toad King Pet
  12384, // Mystical Lantern
  12402, // Waay Chivo Cannon
  12410, // Hands of the Mummy
  12412, // Wizard's Wand
  12416, // Growmlin
  12434, // Royal Master Magic
  12576, // Garuda Mask
  12628, // Shattered Spear
  12642, // Growtronic Halo
  12644, // Royal Growtronic Halo
  12646, // Altair
  12648, // Eivor
  12650, // Bayek
  12834, // Cape of Dunes
  12836, // Royal Cape of Dunes
  12846, // Star Spangled Shield
  12860, // Black Neon Party Yo-Yo
  12866, // Street Dog
  12868, // Street Rabbit
  12870, // Candy Cane Bow
  12876, // Royal Winter Seal Pet
  12886, // Icicle Lance
  12992, // Lightning Guitar
  13058, // Riding Nian
  13060, // Lunar Drum
  13118, // Bear That Cares
  13190, // Dagger of Time
  13196, // Rabbid Buddy
]);

export const BUILD_RANGE_IDS: ReadonlySet<number> = new Set([
  4746, // Diamond Horn
  4748, // Diamond Horns
  4750, // Diamond Devil Horns
  6830, // Exquisite Trowel
  7192, // Shadow Spirit of the Underworld
  7938, // Paintball Power Popper
  9116, // Red Laser Scimitar
  9118, // Green Laser Scimitar
  9120, // Blue Laser Scimitar
  9122, // Purple Laser Scimitar
  9378, // Lightning Gauntlets
  9758, // Neptune's Trident
  10578, // Mystic Battle Lance
  10594, // Golden Ox Pendant
  10678, // Hooves of Cernunnos
  10726, // Bloom Aura
  10748, // One Winged Angel
  10810, // Plasma Heart
  11030, // Pegasus Crown
  11232, // Ouroboros Charm
  11386, // Shadow Cubes Aura
  11624, // Tiger Pauldrons
  11750, // Crescent Charm
  11752, // Royal Crescent Charm
  11760, // Growing Guardian Armor
  11788, // Easter Creature
  11820, // Crown of Spring
  11822, // Crown of Summer
  11824, // Crown of Autumn
  11826, // Crown of Winter
  11878, // Artist's Hair
  11882, // Neurovision
  11884, // Royal Neurovision
  12000, // Pineapple Warrior Charm
  12014, // Dal's Phasers
  12016, // Gwyn's Heirloom
  12020, // Jankom Pog's Multi-Mitt
  12172, // Ethereal Chains
  12178, // Parrot Dude!
  12182, // Pearl Tiki Crown
  12188, // Neptune's Crown
  12190, // Ultraviolet Charm
  12240, // Oceanaura
  12296, // Braided Golden Hair
  12302, // Lightning Horns
  12304, // Owls of Athena
  12386, // Mooncake Paper Lanterns
  12656, // Pontianak Pet
  12834, // Cape of Dunes
  12836, // Royal Cape of Dunes
  12858, // Black Ultraviolet Charm
  12888, // Boots of Deepest Winter
  13076, // Wujing's Beads
  13168, // Pet Chorizo
]);

export const DOUBLE_JUMP_IDS: ReadonlySet<number> = new Set([
  156, // Fairy Wings
  362, // Angel Wings
  678, // Crimson Eagle Wings
  736, // Play Wings
  818, // Ripper Wings
  820, // Seil's Magic Orbs
  1166, // Vampire Cape
  1206, // Devil Wings
  1460, // Golden Angel Wings
  1550, // Bubble Wings
  1574, // Parrot Wings
  1672, // Rainbow Wings
  1674, // Phoenix Wings
  1738, // Crystal Cape
  1780, // Legendbot-009
  1784, // Legendary Wings
  1824, // Autumn Wings
  1934, // Orbs Of Elixir
  1936, // Blazing Electro Wings
  1938, // Diamond Wings
  1958, // Genuine Rings
  1970, // Nightmare Devil Wings
  2158, // Super Cape - Red
  2160, // Super Cape - Blue
  2162, // Super Cape - Green
  2164, // Super Cape - Purple
  2166, // Super Cape - Black
  2168, // Super Cape - Gold
  2254, // Red Crystal Wings
  2256, // Blue Crystal Wings
  2258, // Green Crystal Wings
  2260, // Purple Crystal Wings
  2262, // Golden Crystal Wings
  2264, // Aqua Crystal Wings
  2390, // Teeny Angel Wings
  2392, // Teeny Golden Wings
  2438, // Super Cape - Emerald
  2538, // Super Cape - Pink
  2642, // Cape of Shadows
  2722, // Golden Aura
  2778, // Super Cape - Pineapple
  3104, // Flaming Cape
  3112, // Inside-Out Vampire Cape
  3114, // Black Aura
  3120, // Teeny Devil Wings
  3134, // Wolf Spirit
  3144, // Cosmic Cape
  3442, // Riding Bumblebee
  3512, // Saturday Wings
  3858, // Super Cape - Autumn
  4184, // Riding Raven
  4412, // Pegasus
  4414, // Golden Pegasus
  4534, // Golden Razor Wings
  4628, // Kudo's Carriage
  4970, // Pink Aura
  4972, // Blue Aura
  4986, // Inside-Out Devil Wings
  5020, // Prismatic Aura
  5322, // Zephyr Helm
  5738, // Rainbow Cape
  5754, // Draconic Wings
  6004, // Bear Spirit
  6144, // Aurora Wings
  6284, // Flaming Aura
  6334, // Danieldd's Chimera Wings
  6694, // Super Utility Wings
  6758, // Cloak of Hoveration
  6818, // Nightwings
  6842, // Raven Wings
  7084, // Ezio's Cape
  7104, // Dark Aurora Wings
  7150, // Stone Gargoyle Wings
  7196, // Monarch Butterfly Wings
  7304, // Tiger Spirit
  7350, // Turkey Wings
  7414, // Chipmunk
  7416, // Snow Leopard Tail
  7502, // OVEROLL's Wings
  7582, // Robotic MK.IV Wings
  7648, // Huginn and Muninn - Odin's Ravens
  7670, // Floating Speakers
  7676, // Dragon Warrior's Shield - Crimson
  7678, // Dragon Warrior's Shield - Purple
  7680, // Dragon Warrior's Shield - Silver
  7682, // Dragon Warrior's Shield - Diamond
  7696, // Draconic Rocket Parasol
  7734, // Legendary Dragon Knight's Wings
  7834, // Stained Glass Heartwings
  7910, // Eagle Spirit
  7914, // Condor Wings
  7916, // Airplane Wings
  8024, // Purple Aura
  8026, // Green Aura
  8194, // Glowy Cape
  8286, // Da Vinci Wings
  8302, // Steampunk Wings
  8308, // Reg4shi's Archangel Wings
  8362, // The Fly
  8366, // Extra Undead Arms
  8552, // Angel of Mercy's Wings
  8576, // Nightking's Cape - Dark Red
  8578, // Nightking's Cape - Dark Purple
  8580, // Nightking's Cape - Black
  8582, // Nightking's Cape - Midnight Blue
  8586, // EzCookOven's Robotic Tentacles
  8588, // Phoenix Hair
  8862, // Valkyrie's Wings
  8914, // Mosquito King's Wings
  9006, // Spirit of Anubis
  9008, // Cursed Spirit Pendant - Red
  9010, // Cursed Spirit Pendant - Green
  9012, // Cursed Spirit Pendant - Purple
  9014, // Cursed Spirit Pendant - Blue
  9064, // Rainbow Crystal Cloak
  9094, // Dark Doctor's Cloak
  9114, // Nightmare Teeny Devil Wings
  9132, // Turkey Hat
  9172, // Armored WinterBot - Back
  9182, // Frosty Wings
  9184, // Riding Eagle Owl
  9190, // Cloak of Fire and Ice
  9210, // Winter Radiance Aura
  9320, // Cloud Nine Cape
  9322, // Golden Sunset Cape
  9344, // Datemaster's Heart Locket
  9352, // Pink Teeny Angel Wings
  9394, // Balrog Wings
  9408, // Galaxy Aura
  9422, // Shamrock Wings
  9428, // Money Aura
  9446, // Egg Champion Cape
  9610, // Mexican Hot Sauce Rocket Pack
  9656, // Pineapple Coronet
  9712, // Crystal Aura
  9730, // Phoenix Scarf
  9732, // Greg, The Octopus
  9760, // Pegasus Wings
  10054, // Zodiac Wings
  10148, // Harvest Shawl
  10168, // Bling Wings
  10170, // Aqua Wings
  10172, // Neon Wings
  10178, // Growtopia Fried Wings
  10180, // Party Plume Wings
  10182, // Musical Wings
  10184, // Dark Sunset Cape
  10186, // Darkest Skull Parasol
  10188, // Ghoulish Wings
  10210, // Cloak of Equilibrium
  10332, // Matrix Aura
  10338, // Black Egg Champion Cape
  10424, // Rift Cape
  10426, // Mystic Snow Fox
  10496, // Crown of the Cosmos
  10500, // Snow Aura
  10502, // Neon Tree Aura
  10534, // Confetti Jump Pack
  10576, // Draconic Soul Aura
  10632, // Silk Scarf
  10634, // Golden Silk Scarf
  10644, // Golden Heart Aura
  10666, // Grow Air Balloon
  10674, // Crown of Seasons
  10684, // Mothman Wings
  10754, // Helping Hand
  10806, // Volcanic Cape
  10892, // Pineapple Aura
  10952, // Space Badger
  10954, // Space Mouse
  10956, // Space Dog
  10958, // Space Pig
  10960, // Space Rabbit
  11016, // Dark Assassin's Cape
  11048, // Summer Glider
  11050, // Ultraviolet Aura
  11134, // Samille's Soul Abductor
  11142, // Legendary Owl
  11238, // Fall Wings
  11288, // Wyvern Wings
  11292, // Lightning Umbrella
  11294, // Lucid Wings
  11300, // Neon Party Cape
  11302, // Sacred Scarf
  11318, // Possessing Scarf
  11350, // American Eagle Wings
  11352, // Star Aura
  11356, // Ameri-car
  11378, // Black Harvest Shawl
  11462, // Wings of Deepest Winter
  11478, // Rift Wings
  11480, // Northern Lights Aura
  11504, // Fairy Light Wings
  11506, // Mask of The Dragon
  11508, // Royal Mask of The Dragon
  11544, // Partydactyl Wings
  11548, // Guardian Armor
  11552, // Royal Guardian Armor
  11554, // Bodvar
  11556, // Val
  11558, // Sam Fisher
  11560, // Ezio
  11588, // Wings of Daidalos
  11660, // Shattered Wings
  11662, // Royal Shattered Wings
  11664, // Heartbreak Wings
  11666, // Golden Heartbreak Wings
  11714, // Shamrock Shields
  11724, // Cauldron of the Dagda
  11766, // Other Winged Angel
  11790, // Mechanical Dove Wings
  11792, // Easter Kite Aura
  11818, // Equinox Scarf
  11870, // Volcanic Wings
  11906, // Nocturnal Crown
  11908, // Royal Nocturnal Crown
  11988, // Pineapple Parasol
  11992, // Pineapple Wings
  12174, // Pearl Butterfly Wings
  12186, // Phoenix Feet
  12224, // Fire Chakram
  12234, // Atlantean Wings
  12246, // Staff of Gale
  12248, // Royal Staff of Gale
  12304, // Owls of Athena
  12306, // DIY Wings
  12350, // Personal Storm Cloud
  12354, // Garuda Wings
  12376, // Harvest Blossom Wings
  12380, // Astral Aura - Rabbit
  12388, // Astral Aura - Dragon
  12390, // Astral Aura - Lion
  12406, // Ghastly Wings
  12414, // Cursed Heartbreak Wings
  12418, // Shawl of Shadows
  12432, // Master Magic
  12434, // Royal Master Magic
  12630, // Kanji Scarf
  12632, // Starfire Crown
  12634, // EQ Aura
  12638, // Lightning Wings
  12640, // Minokawa Wings
  12646, // Altair
  12648, // Eivor
  12650, // Bayek
  12842, // Sgt. Stuffins' Wings
  12848, // Stars and Stripes Cape
  12856, // Noir American Eagle Wings
  12864, // Matrix Trenchcoat
  12866, // Street Dog
  12868, // Street Rabbit
  12872, // Red Panda Spirit
  12874, // Royal Red Panda Spirit
  12892, // Snow Monarch's Mantle
  12996, // Aluminiwings
  13002, // Sprinkle Jetpack
  13022, // Scarf of Chains
  13024, // Royal Scarf of Chains
  13062, // Firework Wings
  13068, // Draconic Crown
  13106, // Wings of Glory
  13108, // Royal Wings of Glory
  13112, // Dynamite Sparks
  13140, // Cotton Candy Cape
  13162, // Slopestyle Bike
  13196, // Rabbid Buddy
  13228, // Archangel Wings
]);

export const SPEEDY_IDS: ReadonlySet<number> = new Set([
  496, // Air Robinsons
  592, // Tiny Horsie
  760, // Pleiadian Star Ship
  766, // Little Red Corvette
  1012, // Stick Horse
  1018, // Tiny Appaloosa
  1176, // Aimster's Nightmare
  1178, // Skeletal Horsie
  1272, // Ambulance
  1274, // Edison Zoomster
  1320, // Riding Raptor
  1496, // Rushboard
  1582, // Pink Cadillac
  1740, // StarBoard
  1758, // Growboard
  1780, // Legendbot-009
  1822, // Golden Air Robinsons
  1940, // Diamond Rocket Shoes
  1950, // Growley Motorcycle
  1978, // Avenie Golden Horse
  2048, // Riding Comet
  2064, // Riding Meteor
  2214, // Ice Horse
  2220, // Tiny Tank
  2230, // Snowmobile
  2384, // Love Bug
  2394, // Golden Love Bug
  2402, // Irish Sport Horsie
  2574, // Ride'O'Gold
  2868, // White Fury
  2878, // FC Cleats
  2880, // Man U Cleats
  2974, // Red Bicycle
  2984, // Riding War Wolf
  3068, // Fire Truck
  3074, // Floating Leaf
  3118, // Riding Demon Dog
  3230, // Toboggan
  3250, // Riding Winter Wolf
  3650, // Riding Silkworm - Red
  3652, // Riding Silkworm - Green
  3654, // Riding Silkworm - Blue
  3656, // Riding Silkworm - Black
  3658, // Riding Silkworm - White
  3660, // Riding Silkworm - Grey
  3662, // Riding Silkworm - Purple
  3664, // Riding Silkworm - Yellow
  3666, // Riding Silkworm - Aqua
  3696, // Riding Phoenix
  3788, // Riding Broomstick
  3894, // Harvest Robinsons
  4112, // Blue Riding Raptor
  4114, // Brown Riding Raptor
  4116, // Red Riding Raptor
  4118, // Golden Riding Raptor
  4152, // Apocalypse Steed
  4168, // Demon Chariot
  4262, // Toy Train
  4536, // Cosmic Sky Horse
  4662, // Riding Fiesta Burrito
  4714, // Minecart
  4948, // Solar Chariot
  4988, // Speed Medallion
  4990, // Skateboard
  5012, // Flaming Horsie
  5018, // Riding Chicken
  5210, // El Pollo Diablo
  5264, // Neon Nerves
  5648, // USMom's Talaria
  5650, // Golden Talaria
  6112, // Pine-ch Buggy
  6196, // Guild Night Stallion
  6294, // Raptor Legs
  6298, // Smoog the Great Dragon
  6376, // MagTron LightCycle
  6670, // World Cup Cleats
  6780, // Dabstep Low Top Sneakers
  6782, // Horns of Infinity
  6982, // Wheelchair Speedster
  6996, // Fishing Dinghy
  7100, // Famine's Steed
  7146, // Mountain Dire Wolf
  7296, // Scavenger Wheels
  7298, // Scavenger Lord's Wheels
  7348, // Riding Turkey
  7384, // Go-Go-Growformer!
  7432, // Snow Husky Sledge
  7642, // Golden Battle Boar
  7654, // Thor's Chariot
  7906, // Guild Show Horse
  7908, // Guild Noble's Carriage
  7918, // Sturdy Crackfire Fighter
  8016, // Ultra Spring Flinger Shoes
  8018, // S.P.I.D.E.R. Legs
  8288, // Genie's Lamp - Green
  8290, // Genie's Lamp - Yellow
  8292, // Genie's Lamp - Red
  8294, // Genie's Lamp - Blue
  8356, // Riding Poop
  8368, // Riding 'roach
  8488, // Chaos Corruption
  8494, // Snakewolf
  8512, // Slippery Pineapple Squishers
  8812, // Riding Firefly
  8830, // Black Shoes
  8834, // TK69's Mystical Etherboard
  8856, // Samurai's Waraji
  8898, // Riding World Lock - Green Light
  8900, // Riding World Lock - Purple Light
  8902, // Riding World Lock - White Light
  8904, // Riding World Lock - Yellow Light
  8948, // Speeder
  8952, // Monster Truck
  8956, // Ghost Mobile
  8958, // Ghost Rider Bike
  9034, // Tarantula Legs
  9036, // Horns of Growganoth
  9038, // Supernaturally Speedy Black High Heels
  9056, // Demon Night Stallion
  9134, // Riding Bell
  9136, // Dueling Star Fighter - Rebel Raider
  9138, // Dueling Star Fighter - Imperial Enforcer
  9174, // Armored WinterBot - Feet
  9208, // Cute Riding Polar Bear
  9252, // Confetti Rocket Shoes
  9344, // Datemaster's Heart Locket
  9360, // Armored Riding Troll
  9426, // Dala Horsie
  9442, // Chick Tricycle
  9452, // Loafers
  9608, // Chip-and-Dip
  9612, // Mexican Pointy Boots
  9648, // Go Anywhere Surfboard
  10044, // Golem's Gift
  10066, // Riding Gorilla
  10132, // Yin Yang Pendant
  10236, // Zombie Horse
  10248, // Riding RV
  10438, // Snow Leopard Shawl
  10492, // Radical Rollers
  10600, // 2014 - Zodiac Year of the Horse
  10602, // 2015 - Zodiac Year of the Goat
  10604, // 2016 - Zodiac Year of the Monkey
  10606, // 2017 - Zodiac Year of the Rooster
  10608, // 2018 - Zodiac Year of the Dog
  10610, // 2019 - Zodiac Year of the Pig
  10612, // 2020 - Zodiac Year of the Rat
  10614, // 2021 - Zodiac Year of the Ox
  10618, // Perilous Pirate Ship
  10678, // Hooves of Cernunnos
  10688, // Cardboard Nessie
  10720, // Easter Jeepney
  10728, // Home Made Butter Lamb
  10774, // Field Medics Mecha Med Scarf
  10878, // Radical Rider
  10890, // Rocket Powered Pineapple Vacuum
  10914, // Pure Being of Light and Shadow
  10990, // Alien Recon Wagon
  11006, // Soul Scythe
  11008, // Phoenix Armor
  11012, // Neptune's Chariot
  11028, // Pegasus Shoes
  11090, // Mecha Med Shoes
  11132, // Noodle Bowl Hat
  11142, // Legendary Owl
  11164, // Rainbow Shoes
  11168, // Riding Cloud
  11242, // Harvest Hood-ini
  11310, // Trick or Treat Troll
  11354, // Turkey Float
  11356, // Ameri-car
  11382, // Black Radical Rollers
  11456, // Diamond Dog Sledge
  11468, // Candy Cane Cruiser
  11532, // Radical Stage
  11620, // 2022 - Zodiac Year of the Tiger
  11628, // Fireworks Feet
  11700, // Enchanted Broomstick
  11708, // Superstar Sneakers
  11722, // Rainbow Cloud Rider
  11724, // Cauldron of the Dagda
  11784, // Hip Hops
  11828, // Boots of Spring
  11830, // Boots of Summer
  11832, // Boots of Autumn
  11834, // Boots of Winter
  11904, // Golden Radical Rider
  12042, // The Runaway
  12050, // Class D Loader
  12186, // Phoenix Feet
  12236, // Robe of Tentacles
  12268, // Vacation Van
  12298, // Typewriter Hat
  12344, // Lightning Boots
  12346, // Royal Lightning Boots
  12372, // Noodle's Loaf Hat
  12582, // Garuda Boots
  12630, // Kanji Scarf
  12632, // Starfire Crown
  12636, // Super Speeder
  12878, // Snowboard
  12882, // Ursal Hood
  12888, // Boots of Deepest Winter
  12890, // Riding Gavle Goat
  13058, // Riding Nian
  13064, // 2023 - Zodiac Year of the Rabbit
  13068, // Draconic Crown
  13104, // Boosted Boots
  13120, // Centaur Legs
  13162, // Slopestyle Bike
  13164, // Iroquois Helmet
]);
