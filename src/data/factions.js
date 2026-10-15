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
    gunners: { coat: '#1f2f5e', facings: '#b3202b', trousers: '#1f2f5e' },   // Royal Artillery: blue faced red
    batteries: ['Captain Sandham\u2019s Coy, RA', 'Bull\u2019s Troop, RHA', 'Ross\u2019s Troop, RHA', 'Captain Bolton\u2019s Coy, RA'],
  },
  french: {
    name: 'French', adj: 'French',
    coat: '#233f8c', facings: '#c0262b', trousers: '#e6e1d4', hat: '#121212', belts: '#efeadb',
    ranks: 3, meleeSkill: 1.12, nerve: 2,
    columns: true,          // attacks in column of attack and tries to carry the position with the bayonet
    gunners: { coat: '#1f2f5e', facings: '#c0262b', trousers: '#1f2f5e' },   // foot artillery: blue faced red
    batteries: ['6e Cie, 1er Rég. d\u2019artillerie à pied', '3e Cie, 6e d\u2019artillerie', '2e Cie, 8e d\u2019artillerie', 'Batterie de la Garde'],
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

// HORSE — French squadrons (a company's worth of troopers). The campaign brings the heavier ones in later.
//   melee: with the sabre/lance · mass: weight at the gallop · armour: × chance a ball hits home
const CAV_TYPES = {
  chasseurs: { faction: 'french', price: 2.2, name: 'Chasseurs à cheval', short: 'Chasseurs', coat: '#2f5a35', facings: '#c0262b', hat: '#121212', horse: 0,
    melee: 1.0, mass: 1.0, armour: 1, speed: 1.05, weapon: 'sabre', nerve: 0,
    names: ['2e Esc., 7e Chasseurs', '1er Esc., 13e Chasseurs', '3e Esc., 20e Chasseurs'] },
  lancers: { faction: 'french', price: 2.6, name: 'Lanciers', short: 'Lancers', coat: '#1c2f6e', facings: '#c0262b', hat: '#c0262b', horse: 1,
    melee: 1.15, mass: 1.05, armour: 1, speed: 1.0, weapon: 'lance', nerve: 2, pursuit: 1.4,
    names: ['1er Esc., 2e Chevau-légers lanciers', '2e Esc., 5e Lanciers', 'Lanciers polonais de la Garde'] },
  cuirassiers: { faction: 'french', price: 3.4, name: 'Cuirassiers', short: 'Cuirassiers', coat: '#233f8c', facings: '#c0262b', hat: '#c9ced2', horse: 2,
    melee: 1.3, mass: 1.4, armour: 0.75, speed: 0.92, weapon: 'sabre', nerve: 5, cuirass: true,
    names: ['1er Esc., 4e Cuirassiers', '2e Esc., 9e Cuirassiers', '3e Esc., 12e Cuirassiers'] },
  // ours, for the battle builder (and one day the campaign)
  light_dragoons: { faction: 'british', price: 2.2, name: 'Light Dragoons', short: 'Light Dragoons', coat: '#1c2a52', facings: '#d8c27a', hat: '#121212', horse: 0,
    melee: 1.0, mass: 1.0, armour: 1, speed: 1.05, weapon: 'sabre', nerve: 0,
    names: ['A Troop, 16th Light Dragoons', 'B Troop, 14th Light Dragoons', 'C Troop, 23rd Light Dragoons'] },
  heavy_dragoons: { faction: 'british', price: 3.0, name: 'Heavy Dragoons', short: 'Dragoons', coat: '#b3202b', facings: '#24306a', hat: '#121212', horse: 1,
    melee: 1.25, mass: 1.3, armour: 1, speed: 0.95, weapon: 'sabre', nerve: 4,
    names: ['A Troop, 2nd (Royal North British) Dragoons', 'B Troop, 1st Royal Dragoons', 'E Troop, 6th Inniskilling Dragoons'] },
};
const HORSE_COATS = ['#5a3a22', '#3d2a1c', '#6b4a2c', '#2a201a', '#7a5a3a', '#4a3424'];

const RANKS = [
  { title: 'Lieutenant', renown: 0, company: 24 },
  { title: 'Captain', renown: 70, company: 32 },
  { title: 'Major', renown: 200, company: 40 },
  { title: 'Lieutenant-Colonel', renown: 420, company: 48 },
];
