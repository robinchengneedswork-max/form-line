'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FACTIONS — uniforms, drill and music. The era is data: a Civil War
//  campaign is another pair of entries here plus two tunes in tunes.js.
//
//  ranks: the British fought two deep, the French three. Only the front
//  two ranks can fire (CFG.FIRING_RANKS), so a French company trades
//  firepower for depth — better in the charge, worse in the firefight.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const FACTIONS = {
  british: {
    name: 'British', adj: 'British',
    coat: '#b3202b', facings: '#24306a', trousers: '#cfc8b4', hat: '#17140f', belts: '#efeadb',
    ranks: 2, meleeSkill: 1.0, nerve: 0,
    flag: 'union', tune: 'grenadiers', cadence: 'quickstep',
    cry: 'Huzzah!',
    companies: ['Light Coy, 1/43rd', 'No. 4 Coy, 1/52nd', 'No. 7 Coy, 2/95th', 'Grenadier Coy, 1/28th',
                'No. 3 Coy, 1/88th', 'No. 6 Coy, 1/45th', 'No. 2 Coy, 1/7th Fusiliers'],
  },
  french: {
    name: 'French', adj: 'French',
    coat: '#233f8c', facings: '#c0262b', trousers: '#e6e1d4', hat: '#121212', belts: '#efeadb',
    ranks: 3, meleeSkill: 1.12, nerve: 2,
    flag: 'tricolore', tune: 'marseillaise', cadence: 'pas-de-charge',
    cry: "Vive l'Empereur!",
    companies: ['3e Cie, 2/31e Léger', '1re Cie, 1/40e Ligne', 'Voltigeurs, 2/64e', 'Grenadiers, 1/88e',
                '5e Cie, 3/26e Ligne', '2e Cie, 1/17e Léger', '4e Cie, 2/100e Ligne', '6e Cie, 1/28e Ligne'],
  },
};

const FIRST_NAMES = ['John', 'William', 'Thomas', 'James', 'George', 'Joseph', 'Richard', 'Samuel', 'Henry',
  'Edward', 'Robert', 'Daniel', 'Patrick', 'Michael', 'Charles', 'Benjamin', 'Peter', 'Isaac', 'Owen', 'Hugh'];
const SURNAMES = ['Harris', 'Costello', 'Hopkins', 'Plunket', 'Green', 'Tanner', 'Cooper', 'Morris', 'Shaw',
  'Lawrence', 'Wheeler', 'Kincaid', 'Simmons', 'Surtees', 'Donaldson', 'Lamb', 'Anton', 'Pearce', 'Bell',
  'Gunn', 'Hale', 'Moyle', 'Brennan', 'Doyle', "O'Neil", 'Walsh', 'Ellis', 'Hughes', 'Price', 'Rowe', 'Fenn',
  'Keating', 'Mudge', 'Pritchard', 'Sweeney', 'Varley', 'Webb', 'Yates', 'Dunn', 'Bligh'];

const RANKS = [
  { title: 'Lieutenant', renown: 0, company: 24 },
  { title: 'Captain', renown: 70, company: 32 },
  { title: 'Major', renown: 200, company: 40 },
  { title: 'Lieutenant-Colonel', renown: 420, company: 48 },
];
