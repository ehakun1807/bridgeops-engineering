import {
  detectColumnMapping,
  applyMapping,
  parseQty,
  parseCost,
  parseLevel,
  type ColumnMapping
} from '../bomParser';

describe('bomParser - detectColumnMapping', () => {
  it('maps the standard set of headers', () => {
    const { mapping, warnings } = detectColumnMapping([
      'Manufacturer',
      'MPN',
      'Description',
      'Qty',
      'RefDes',
      'Unit Cost',
      'Footprint'
    ]);
    expect(mapping.manufacturer).toBe('Manufacturer');
    expect(mapping.mpn).toBe('MPN');
    expect(mapping.description).toBe('Description');
    expect(mapping.qty).toBe('Qty');
    expect(mapping.refDes).toBe('RefDes');
    expect(mapping.unitCost).toBe('Unit Cost');
    expect(mapping.package).toBe('Footprint');
    expect(warnings).toEqual([]);
  });

  it('prefers Internal PN over generic Part Number', () => {
    const { mapping } = detectColumnMapping(['Internal PN', 'Part Number', 'Qty']);
    expect(mapping.internalPn).toBe('Internal PN');
    expect(mapping.mpn).toBe('Part Number');
  });

  it('recognizes house PN variants', () => {
    expect(detectColumnMapping(['House PN', 'Qty']).mapping.internalPn).toBe('House PN');
    expect(detectColumnMapping(['House Part Number']).mapping.internalPn).toBe(
      'House Part Number'
    );
    expect(detectColumnMapping(['Company Part Number']).mapping.internalPn).toBe(
      'Company Part Number'
    );
    expect(detectColumnMapping(['In-House PN']).mapping.internalPn).toBe('In-House PN');
  });

  it('recognizes site-prefix style internal PN headers (e.g. ACME PN)', () => {
    const { mapping } = detectColumnMapping(['ACME PN', 'MPN', 'Qty']);
    expect(mapping.internalPn).toBe('ACME PN');
    expect(mapping.mpn).toBe('MPN');
  });

  it('maps "Manufacturer Part Number" to mpn (not manufacturer)', () => {
    const { mapping } = detectColumnMapping(['Manufacturer', 'Manufacturer Part Number']);
    expect(mapping.manufacturer).toBe('Manufacturer');
    expect(mapping.mpn).toBe('Manufacturer Part Number');
  });

  it('warns when neither internalPn nor mpn detected', () => {
    const { mapping, warnings } = detectColumnMapping(['Description', 'Qty', 'Cost']);
    expect(mapping.internalPn).toBeUndefined();
    expect(mapping.mpn).toBeUndefined();
    expect(warnings.some((w) => /no internal part-number or MPN/i.test(w))).toBe(true);
  });

  it('warns when qty column missing', () => {
    const { warnings } = detectColumnMapping(['MPN', 'Description']);
    expect(warnings.some((w) => /no quantity column/i.test(w))).toBe(true);
  });

  it('handles assorted spacing / punctuation in headers', () => {
    const { mapping } = detectColumnMapping([
      'Mfr.',
      'M.P.N.',
      'Q.T.Y',
      'Ref-Des'
    ]);
    expect(mapping.manufacturer).toBe('Mfr.');
    expect(mapping.mpn).toBe('M.P.N.');
    expect(mapping.qty).toBe('Q.T.Y');
    expect(mapping.refDes).toBe('Ref-Des');
  });
});

describe('bomParser - applyMapping', () => {
  const mapping: ColumnMapping = {
    internalPn: 'House PN',
    mpn: 'MPN',
    manufacturer: 'Mfr',
    description: 'Desc',
    refDes: 'RefDes',
    qty: 'Qty',
    unitCost: 'Cost',
    package: 'Footprint'
  };

  it('builds normalized BomLine objects', () => {
    const rows = [
      {
        'House PN': 'ACME-1234',
        MPN: 'STM32F407',
        Mfr: 'ST',
        Desc: 'MCU',
        RefDes: 'U1',
        Qty: '1',
        Cost: '$3.50',
        Footprint: 'LQFP-100',
        Extra: 'preserved'
      }
    ];
    const lines = applyMapping(rows, mapping);
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.internalPn).toBe('ACME-1234');
    expect(l.mpn).toBe('STM32F407');
    expect(l.manufacturer).toBe('ST');
    expect(l.qty).toBe(1);
    expect(l.unitCost).toBe(3.5);
    expect(l.package).toBe('LQFP-100');
    expect(l.raw['Extra']).toBe('preserved');
  });

  it('skips rows with no identifier at all', () => {
    const rows = [
      { 'House PN': '', MPN: '', RefDes: '', Desc: '', Qty: '1' },
      { 'House PN': 'X1', MPN: '', RefDes: '', Desc: '', Qty: '1' }
    ];
    const lines = applyMapping(rows, mapping);
    expect(lines).toHaveLength(1);
    expect(lines[0].internalPn).toBe('X1');
  });

  it('defaults qty to 1 when missing or garbage', () => {
    const rows = [
      { 'House PN': 'A', MPN: '', Qty: '' },
      { 'House PN': 'B', MPN: '', Qty: 'abc' },
      { 'House PN': 'C', MPN: '', Qty: '10 pcs' },
      { 'House PN': 'D', MPN: '', Qty: '1,000' }
    ];
    const lines = applyMapping(rows, mapping);
    expect(lines.map((l) => l.qty)).toEqual([1, 1, 10, 1000]);
  });
});

describe('bomParser - parseQty', () => {
  it('handles plain numbers', () => {
    expect(parseQty(10)).toBe(10);
    expect(parseQty('10')).toBe(10);
  });
  it('handles trailing units', () => {
    expect(parseQty('10 pcs')).toBe(10);
    expect(parseQty('5x')).toBe(5);
  });
  it('strips thousands separators', () => {
    expect(parseQty('1,000')).toBe(1000);
  });
  it('falls back to 1 on garbage / empty / negative', () => {
    expect(parseQty('')).toBe(1);
    expect(parseQty(undefined)).toBe(1);
    expect(parseQty('abc')).toBe(1);
    expect(parseQty('-5')).toBe(1);
  });
});

describe('bomParser - bomLevel detection', () => {
  it('detects standard "BOM Level" / "Level" / "Indent" headers', () => {
    expect(detectColumnMapping(['BOM Level', 'MPN', 'Qty']).mapping.bomLevel).toBe('BOM Level');
    expect(detectColumnMapping(['Level', 'MPN', 'Qty']).mapping.bomLevel).toBe('Level');
    expect(detectColumnMapping(['Indent', 'MPN', 'Qty']).mapping.bomLevel).toBe('Indent');
    expect(detectColumnMapping(['Lvl', 'MPN', 'Qty']).mapping.bomLevel).toBe('Lvl');
    expect(detectColumnMapping(['Indent Level', 'MPN', 'Qty']).mapping.bomLevel).toBe('Indent Level');
  });
});

describe('bomParser - parseLevel', () => {
  it('parses integer levels', () => {
    expect(parseLevel(1)).toBe(1);
    expect(parseLevel('2')).toBe(2);
    expect(parseLevel('3')).toBe(3);
  });
  it('parses dotted-path notation as depth', () => {
    expect(parseLevel('1.1')).toBe(2);
    expect(parseLevel('1.2.3')).toBe(3);
    expect(parseLevel('2.4.1.7')).toBe(4);
  });
  it('returns undefined on empty / garbage / zero / negative', () => {
    expect(parseLevel('')).toBeUndefined();
    expect(parseLevel(undefined)).toBeUndefined();
    expect(parseLevel('abc')).toBeUndefined();
    expect(parseLevel(0)).toBeUndefined();
    expect(parseLevel(-1)).toBeUndefined();
  });
});

describe('bomParser - multi-level via applyMapping', () => {
  it('builds BomLine with bomLevel from the mapped column', () => {
    const mapping: ColumnMapping = {
      bomLevel: 'Lvl',
      internalPn: 'House PN',
      qty: 'Qty'
    };
    const rows = [
      { Lvl: '1', 'House PN': 'ACME-TOP', Qty: '1' },
      { Lvl: '2', 'House PN': 'ACME-SUB', Qty: '2' },
      { Lvl: '3', 'House PN': 'ACME-LEAF', Qty: '4' }
    ];
    const lines = applyMapping(rows, mapping);
    expect(lines.map((l) => l.bomLevel)).toEqual([1, 2, 3]);
    expect(lines.map((l) => l.internalPn)).toEqual(['ACME-TOP', 'ACME-SUB', 'ACME-LEAF']);
  });

  it('leaves bomLevel undefined when no level column mapped', () => {
    const mapping: ColumnMapping = { internalPn: 'PN', qty: 'Qty' };
    const rows = [{ PN: 'A', Qty: '1' }];
    expect(applyMapping(rows, mapping)[0].bomLevel).toBeUndefined();
  });
});

describe('bomParser - parseCost', () => {
  it('strips currency symbols and separators', () => {
    expect(parseCost('$1.23')).toBe(1.23);
    expect(parseCost('€1,234.56')).toBe(1234.56);
    expect(parseCost('1,000')).toBe(1000);
  });
  it('returns undefined on empty / garbage', () => {
    expect(parseCost('')).toBeUndefined();
    expect(parseCost(undefined)).toBeUndefined();
    expect(parseCost('not a number')).toBeUndefined();
  });
  it('passes plain numbers through', () => {
    expect(parseCost(3.5)).toBe(3.5);
  });
});
