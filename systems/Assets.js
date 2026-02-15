export const ASSETS = {
  fonts: {
    // Optional: add a TTF/OTF and load it via CSS @font-face as "GameFont".
    // Example files: assets/fonts/GameFont.ttf
    game: { family: "GameFont", url: "assets/fonts/GameFont4.ttf" },
  },

  maps: {
    city: { key: "map_city", url: "assets/maps/City.tmj" },
    forest: { key: "map_forest", url: "assets/maps/Forest.tmj" },
    library: { key: "map_library", url: "assets/maps/Library.tmj" },
  },

  spritesheets: {
  player: { key: "player", url: "assets/sprites/characters/player/player.png", frameWidth: 16, frameHeight: 16, },
  npc_aloise: { key:"npc_aloise", url:"assets/sprites/characters/npcs/celeste.png", frameWidth:16, frameHeight:16 },
  npc_saga: { key:"npc_saga",   url:"assets/sprites/characters/npcs/saga.png", frameWidth:18, frameHeight:18 },
  npc_xia: { key:"npc_xia", url:"assets/sprites/characters/npcs/xia.png", frameWidth:16, frameHeight:16 },
  npc_glad: { key:"npc_glad",   url:"assets/sprites/characters/npcs/glad.png", frameWidth:16, frameHeight:16 },
  npc_mona: { key:"npc_mona", url:"assets/sprites/characters/npcs/mona.png", frameWidth:24, frameHeight:24 },
  npc_snoopy: { key:"npc_snoopy",   url:"assets/sprites/characters/npcs/snoopy.png", frameWidth:32, frameHeight:32 },
  npc_leafeon: { key:"npc_leafeon",   url:"assets/sprites/characters/npcs/leafeon.png", frameWidth:16, frameHeight:16 },
  npc_ares: { key:"npc_ares",   url:"assets/sprites/characters/npcs/ares.png", frameWidth:20, frameHeight:20 },
  npc_napper: { key:"npc_napper",   url:"assets/sprites/characters/npcs/napper.png", frameWidth:18, frameHeight:18 },

  
    
  },

  tilesets: {
    cityTerrain: { key: "ts_city_terrain", url: "assets/images/tilesets/city_tilemap_packed.png" },
    cityObjects: { key: "ts_city_objects", url: "assets/images/tilesets/sprout_objects_tileset_16.png" },

    forestTerrain: { key: "ts_forest_terrain", url: "assets/images/tilesets/tileset_forest_sproutlands.png" },
    forestObjects: { key: "ts_forest_objects", url: "assets/images/tilesets/sprout_objects_tileset_16.png" },

    library: { key: "ts_library", url: "assets/images/tilesets/libassetpack-tiled.png" },
  },

  sfx: {
  knock: { key: "sfx_knock", url: "assets/audio/creatorshome_knock.mp3" },
  trashcan: { key: "sfx_trashcan", url: "assets/audio/trashcan.mp3" },
  item_gained: { key: "sfx_item_gained", url: "assets/audio/item_gained.mp3" },
  special_chicken: { key: "sfx_special_chicken", url: "assets/audio/special_chicken.mp3" },
  keytwist: { key: "sfx_keytwist", url: "assets/audio/keytwist.mp3" },
  bushrustle: { key: "sfx_bushrustle", url: "assets/audio/bushrustle.mp3" },
  grandfatherclock: { key: "sfx_grandfatherclock", url: "assets/audio/grandfatherclock.mp3" },
  bump: { key: "sfx_bump", url: "assets/audio/bump.mp3"},
  bridge_creak: { key: "sfx_bridge_creak", url: "assets/audio/bridge_creak.mp3"},
  old_man: { key: "sfx_old_man", url: "assets/audio/old_man.mp3"},
  ily: { key: "sfx_ily", url: "assets/audio/ily.mp3"},
  traffic: { key: "sfx_traffic", url: "assets/audio/traffic.mp3"},
  paperflip: { key: "sfx_paperflip", url: "assets/audio/paperflip.mp3"},
  ocean: { key: "ocean", url: "assets/audio/ocean.mp3"},
  napper: { key: "napper", url: "assets/audio/Napper.mp3"},

  // music //
  city: { key: "sfx_city", url: "assets/audio/WELCOME_TO_THE_CITY.mp3"},
  forest: { key: "sfx_forest", url: "assets/audio/Scarlet_Forest.mp3"},
  library_happy: { key: "sfx_library_happy", url: "assets/audio/By_Your_Side.mp3"},
  library_sad: { key: "sfx_library_sad", url: "assets/audio/By_Your_Side_Cemetery.mp3"},
  library_lost: { key: "sfx_library_lost", url: "assets/audio/088_Lost_Library.mp3"},
  minesweeper: {key: "sfx_minesweeper", url: "assets/audio/Worlds_End_Valentine.mp3"},

},
};
