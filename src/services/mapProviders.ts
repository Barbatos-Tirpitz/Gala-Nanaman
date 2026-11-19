export const MAP_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
};

export const MAP_PROVIDERS = {
  photon: { version: 1, persistent: true },
  osrm: { version: 1, persistent: false },
  commons: { version: 1, persistent: false },
} as const;