import { projectCertificationGroupMatches } from './whatsapp-certification-group-lookup.util';

describe('projectCertificationGroupMatches', () => {
  it('returns exact group name/JID only', () => {
    expect(projectCertificationGroupMatches([
      { isGroup: true, formattedTitle: 'test1', id: { _serialized: '123@g.us' }, name: 'ignored' },
      { isGroup: true, formattedTitle: 'test10', id: { _serialized: '456@g.us' } },
    ], 'test1')).toEqual([{ name: 'test1', id: '123@g.us' }]);
  });

  it('excludes non-groups and malformed/non-group identifiers', () => {
    expect(projectCertificationGroupMatches([
      { isGroup: false, name: 'test1', id: { _serialized: '1@c.us' } },
      { isGroup: true, name: 'test1', id: { _serialized: '2@c.us' } },
      { isGroup: true, name: 'test1', id: { _serialized: '3@g.us' } },
    ], 'test1')).toEqual([{ name: 'test1', id: '3@g.us' }]);
  });

  it('recognizes groups by the canonical g.us JID when isGroup is absent', () => {
    expect(projectCertificationGroupMatches([
      { formattedTitle: 'test1', id: { _serialized: '120363431495091943@g.us' } },
    ], 'test1')).toEqual([{ name: 'test1', id: '120363431495091943@g.us' }]);
  });

  it('returns duplicate exact groups without selecting a winner and sanitizes fields', () => {
    const result = projectCertificationGroupMatches([
      { isGroup: true, name: 'test1', id: { _serialized: '1@g.us' }, participants: ['secret'], messages: ['secret'] } as any,
      { isGroup: true, subject: 'test1', id: { _serialized: '2@g.us' } },
    ], 'test1');
    expect(result).toEqual([{ name: 'test1', id: '1@g.us' }, { name: 'test1', id: '2@g.us' }]);
    expect(result[0]).not.toHaveProperty('participants');
  });

  it('returns no match for blank, case-different, or absent names', () => {
    expect(projectCertificationGroupMatches([{ isGroup: true, name: 'Test1', id: { _serialized: '1@g.us' } }], 'test1')).toEqual([]);
    expect(projectCertificationGroupMatches([{ isGroup: true, name: 'test1', id: { _serialized: '1@g.us' } }], '  ')).toEqual([]);
  });
});
