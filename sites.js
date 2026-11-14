/* Candidate landing sites. Coordinates are approximate (selenographic degrees, east positive). */
var SITES = [
  { id: 'shackleton', name: 'Shackleton connecting ridge', note: 'Artemis candidate region', lat: -89.45, lon: -137.31 },
  { id: 'gerlache', name: 'de Gerlache rim', note: 'Artemis candidate region', lat: -88.5, lon: -68 },
  { id: 'slater', name: 'Slater plain', note: 'Artemis candidate region', lat: -88.1, lon: 111 },
  { id: 'haworth', name: 'Haworth', note: 'Artemis candidate region', lat: -87.5, lon: -5 },
  { id: 'malapert', name: 'Malapert massif', note: 'Artemis candidate region', lat: -85.99, lon: -2.9 },
  { id: 'nobile', name: 'Nobile rim', note: 'Artemis candidate region, planned VIPER area', lat: -85.42, lon: 31.63 },
  { id: 'cabeus', name: 'Cabeus', note: 'LCROSS impact site, 2009', lat: -84.9, lon: -35.5 },
  { id: 'im2', name: 'Mons Mouton', note: 'IM-2 Athena, 2025', lat: -84.79, lon: 29.2 },
  { id: 'im1', name: 'Malapert A', note: 'IM-1 Odysseus, 2024', lat: -80.13, lon: 1.44 },
  { id: 'schrodinger', name: 'Schrödinger basin', note: 'Planned CLPS far-side target', lat: -75, lon: 132.4 },
  { id: 'ch3', name: 'Shiv Shakti point', note: 'Chandrayaan-3, 2023', lat: -69.37, lon: 32.32 },
  { id: 'a11', name: 'Tranquility Base', note: 'Apollo 11, 1969', lat: 0.674, lon: 23.473 },
  { id: 'a15', name: 'Hadley Rille', note: 'Apollo 15, 1971', lat: 26.132, lon: 3.634 },
  { id: 'a17', name: 'Taurus-Littrow', note: 'Apollo 17, 1972', lat: 20.191, lon: 30.772 },
  { id: 'bg1', name: 'Mare Crisium', note: 'Blue Ghost M1, 2025', lat: 18.56, lon: 61.81 },
  { id: 'slim', name: 'Shioli crater', note: 'SLIM, 2024', lat: -13.316, lon: 25.251 },
  { id: 'reiner', name: 'Reiner Gamma', note: 'Planned IM-3 target', lat: 7.5, lon: -59 },
  { id: 'gruit', name: 'Gruithuisen domes', note: 'Planned CLPS target', lat: 36.3, lon: -40.1 },
  { id: 'arist', name: 'Aristarchus plateau', note: 'Science target', lat: 23.7, lon: -47.4 },
  { id: 'ce4', name: 'Von Kármán crater', note: "Chang'e 4, 2019", lat: -45.444, lon: 177.599 },
  { id: 'ce6', name: 'Apollo basin', note: "Chang'e 6, 2024", lat: -41.64, lon: -153.99 }
];
