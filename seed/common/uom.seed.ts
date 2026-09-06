export interface UomSeed {
  code: string;
  name: string;
  category: 'COUNT' | 'WEIGHT' | 'LENGTH' | 'VOLUME' | 'TIME';
}

export const COMMON_UOMS: UomSeed[] = [
  { code: 'PCS', name: 'Pieces', category: 'COUNT' },
  { code: 'UNIT', name: 'Units', category: 'COUNT' },
  { code: 'SET', name: 'Set', category: 'COUNT' },
  { code: 'BOX', name: 'Box', category: 'COUNT' },
  { code: 'KG', name: 'Kilograms', category: 'WEIGHT' },
  { code: 'GRAM', name: 'Grams', category: 'WEIGHT' },
  { code: 'TON', name: 'Metric Tons', category: 'WEIGHT' },
  { code: 'METER', name: 'Meters', category: 'LENGTH' },
  { code: 'MM', name: 'Millimeters', category: 'LENGTH' },
  { code: 'LITER', name: 'Liters', category: 'VOLUME' },
  { code: 'ML', name: 'Milliliters', category: 'VOLUME' },
  { code: 'ROLL', name: 'Rolls', category: 'COUNT' },
];
