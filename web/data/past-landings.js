/* Past soft landings on the Moon, used as candidate landing sites.
   Coordinates: planetocentric latitude, east-positive longitude, rounded to 0.01 deg (about 300 m).
   Source: published landing coordinates (LROC images of the landers, NASA NSSDCA). They are
   approximate at that rounding level; none of them are in the analysed terrain data, so the app
   shows them as reference points, ranked below the analysed sites: coarse 720 m polar grid south of 75 S,
   smooth sphere elsewhere, always labelled. A landing whose id is also in the data file is treated as an
   analysed site instead. */
var PAST_LANDINGS = [
  { id: 'apollo-11', name: 'Apollo 11', note: 'NASA, crewed, 1969 · Mare Tranquillitatis', lat: 0.67, lon: 23.47 },
  { id: 'apollo-12', name: 'Apollo 12', note: 'NASA, crewed, 1969 · Oceanus Procellarum', lat: -3.01, lon: -23.42 },
  { id: 'apollo-14', name: 'Apollo 14', note: 'NASA, crewed, 1971 · Fra Mauro', lat: -3.65, lon: -17.47 },
  { id: 'apollo-15', name: 'Apollo 15', note: 'NASA, crewed, 1971 · Hadley–Apennine', lat: 26.13, lon: 3.63 },
  { id: 'apollo-16', name: 'Apollo 16', note: 'NASA, crewed, 1972 · Descartes highlands', lat: -8.97, lon: 15.50 },
  { id: 'apollo-17', name: 'Apollo 17', note: 'NASA, crewed, 1972 · Taurus–Littrow', lat: 20.19, lon: 30.77 },
  { id: 'surveyor-1', name: 'Surveyor 1', note: 'NASA, robotic, 1966 · Flamsteed P', lat: -2.47, lon: -43.34 },
  { id: 'surveyor-3', name: 'Surveyor 3', note: 'NASA, robotic, 1967 · Oceanus Procellarum', lat: -3.02, lon: -23.42 },
  { id: 'surveyor-5', name: 'Surveyor 5', note: 'NASA, robotic, 1967 · Mare Tranquillitatis', lat: 1.46, lon: 23.19 },
  { id: 'surveyor-6', name: 'Surveyor 6', note: 'NASA, robotic, 1967 · Sinus Medii', lat: 0.47, lon: -1.43 },
  { id: 'surveyor-7', name: 'Surveyor 7', note: 'NASA, robotic, 1968 · Tycho rim', lat: -40.98, lon: -11.51 },
  { id: 'luna-9', name: 'Luna 9', note: 'USSR, robotic, 1966 · Oceanus Procellarum', lat: 7.08, lon: -64.37 },
  { id: 'luna-13', name: 'Luna 13', note: 'USSR, robotic, 1966 · Oceanus Procellarum', lat: 18.87, lon: -62.05 },
  { id: 'luna-16', name: 'Luna 16', note: 'USSR, sample return, 1970 · Mare Fecunditatis', lat: -0.51, lon: 56.36 },
  { id: 'luna-17', name: 'Luna 17', note: 'USSR, Lunokhod 1, 1970 · Mare Imbrium', lat: 38.24, lon: -35.00 },
  { id: 'luna-20', name: 'Luna 20', note: 'USSR, sample return, 1972 · Apollonius highlands', lat: 3.79, lon: 56.62 },
  { id: 'luna-21', name: 'Luna 21', note: 'USSR, Lunokhod 2, 1973 · Le Monnier', lat: 26.00, lon: 30.41 },
  { id: 'luna-24', name: 'Luna 24', note: 'USSR, sample return, 1976 · Mare Crisium', lat: 12.71, lon: 62.21 },
  { id: 'change-3', name: "Chang'e 3", note: 'CNSA, robotic, 2013 · Mare Imbrium', lat: 44.12, lon: -19.51 },
  { id: 'change-4', name: "Chang'e 4", note: 'CNSA, far side, 2019 · Von Kármán crater', lat: -45.44, lon: 177.60 },
  { id: 'change-5', name: "Chang'e 5", note: 'CNSA, sample return, 2020 · Mons Rümker', lat: 43.06, lon: -51.92 },
  { id: 'change-6', name: "Chang'e 6", note: 'CNSA, far-side sample return, 2024 · Apollo basin', lat: -41.64, lon: -153.99 },
  { id: 'chandrayaan-3', name: 'Chandrayaan-3', note: 'ISRO, robotic, 2023 · south polar highlands', lat: -69.37, lon: 32.32 },
  { id: 'slim', name: 'SLIM', note: 'JAXA, robotic, 2024 · Shioli crater', lat: -13.32, lon: 25.25 },
  { id: 'im-1', name: 'IM-1 Odysseus', note: 'Intuitive Machines (CLPS), 2024 · Malapert A', lat: -80.13, lon: 1.44 },
  { id: 'blue-ghost-1', name: 'Blue Ghost Mission 1', note: 'Firefly (CLPS), 2025 · Mare Crisium', lat: 18.56, lon: 61.81 },
  { id: 'im-2', name: 'IM-2 Athena', note: 'Intuitive Machines (CLPS), 2025 · Mons Mouton area', lat: -84.79, lon: 29.20 }
];
