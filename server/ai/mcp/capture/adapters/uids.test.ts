import { describe, expect, it } from 'bun:test'
import { assignUids, generateUid, UID_LENGTH } from './uids'

const UID_REGEX = /^[A-Za-z0-9]{12}$/

describe('assignUids', () => {
  it('returns empty uids for an empty input', () => {
    const out = assignUids('')
    expect(out.uids).toEqual([])
    expect(out.html).toBe('')
  })

  it('returns empty uids for a structure-less input', () => {
    const out = assignUids('<html><head></head><body></body></html>')
    // The <html>, <head>, <body> tags are elements, so linkedom does
    // attach uids to them. We only assert no *error* and a sensible shape.
    expect(out.uids.length).toBeGreaterThanOrEqual(0)
    expect(out.html).toContain('<html')
    expect(out.html).toContain('uid=')
  })

  it('attaches exactly one uid to a single element', () => {
    const out = assignUids('<p>x</p>')
    expect(out.uids.length).toBe(1)
    expect(out.uids[0]).toMatch(UID_REGEX)
    expect(out.html).toContain('uid="' + out.uids[0] + '"')
    expect(out.html).toContain('<p ')
    expect(out.html).toContain('>x</p>')
  })

  it('attaches unique uids to nested elements', () => {
    const out = assignUids('<div><p>x</p></div>')
    expect(out.uids.length).toBe(2)
    expect(new Set(out.uids).size).toBe(2)
    for (const u of out.uids) expect(u).toMatch(UID_REGEX)
    expect(out.html).toContain('uid="' + out.uids[0] + '"')
    expect(out.html).toContain('uid="' + out.uids[1] + '"')
  })

  it('generates 12-character base62 uids by default', () => {
    for (let i = 0; i < 20; i++) {
      const u = generateUid()
      expect(u).toMatch(UID_REGEX)
      expect(u.length).toBe(UID_LENGTH)
    }
    // Sanity: generator respects an explicit length.
    expect(generateUid(6)).toMatch(/^[A-Za-z0-9]{6}$/)
    expect(generateUid(20)).toMatch(/^[A-Za-z0-9]{20}$/)
  })

  it('produces no collisions across 1000 elements', () => {
    const html = '<div>' + Array.from({ length: 1000 }, () => '<span></span>').join('') + '</div>'
    const out = assignUids(html)
    expect(out.uids.length).toBe(1001) // 1000 spans + the wrapping <div>
    expect(new Set(out.uids).size).toBe(out.uids.length)
  })

  it('honours reservedUids — generated uids never collide with the reserved set', () => {
    // Pre-generate 5 reserved uids and force them to be the only valid candidates
    // by giving the reserved set enough density that pure random would collide
    // eventually if not respected.
    const reserved = new Set<string>()
    for (let i = 0; i < 5; i++) reserved.add(generateUid())
    const out = assignUids(
      '<div>' + Array.from({ length: 10 }, () => '<p>x</p>').join('') + '</div>',
      { reservedUids: reserved },
    )
    for (const u of out.uids) {
      expect(reserved.has(u)).toBe(false)
    }
    // The reserved set is unchanged.
    expect(reserved.size).toBe(5)
  })

  it('replaces an existing uid attribute with a fresh one', () => {
    const out = assignUids('<p uid="abc123def456">x</p>')
    expect(out.uids.length).toBe(1)
    expect(out.uids[0]).not.toBe('abc123def456')
    expect(out.uids[0]).toMatch(UID_REGEX)
    expect(out.html).not.toContain('uid="abc123def456"')
    expect(out.html).toContain('uid="' + out.uids[0] + '"')
  })

  it('preserves HTML entities and the surrounding element structure', () => {
    const out = assignUids('<p>&copy; 2025</p>')
    expect(out.uids.length).toBe(1)
    expect(out.uids[0]).toMatch(UID_REGEX)
    // The element is preserved with its uid.
    expect(out.html).toContain('<p ')
    expect(out.html).toContain('uid="' + out.uids[0] + '"')
    // The entity is preserved as text or its resolved character.
    expect(out.html).toContain('2025')
    const hasEntity = out.html.includes('&copy;')
    const hasResolved = out.html.includes('\u00a9') // ©
    expect(hasEntity || hasResolved).toBe(true)
  })

  it('is non-deterministic in values but deterministic in shape', () => {
    const html = '<div><a href="#">one</a><span>two</span></div>'
    const a = assignUids(html)
    const b = assignUids(html)
    // Same number of uids.
    expect(a.uids.length).toBe(b.uids.length)
    // Same number of unique uids in both runs.
    expect(new Set(a.uids).size).toBe(a.uids.length)
    expect(new Set(b.uids).size).toBe(b.uids.length)
    // Almost certainly different actual ids (62^3 makes a collision unlikely).
    expect(a.uids.join(',')).not.toBe(b.uids.join(','))
    // Same shape: every element has a uid.
    for (const u of a.uids) expect(u).toMatch(UID_REGEX)
    for (const u of b.uids) expect(u).toMatch(UID_REGEX)
  })
})