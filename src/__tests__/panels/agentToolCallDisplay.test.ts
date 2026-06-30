import { describe, expect, test } from 'bun:test'
import { getToolCallDisplay } from '@site/panels/AgentPanel'

describe('getToolCallDisplay', () => {
  test('formats document reads as readable document actions', () => {
    expect(getToolCallDisplay('read_document', {
      document: { type: 'template', id: 'tpl_home' },
    })).toEqual({
      title: 'Reading document',
      detail: 'Template tpl_home',
      icon: 'document',
      tone: 'read',
    })
  })

  test('summarizes CSS selectors without exposing applyCss', () => {
    expect(getToolCallDisplay('applyCss', {
      css: '.hero { color: red; } .cta:hover { color: blue; }',
    })).toEqual({
      title: 'Updating CSS',
      detail: '.hero, .cta:hover',
      icon: 'style',
      tone: 'style',
    })
  })

  test('formats content workspace writes', () => {
    expect(getToolCallDisplay('set_document_status', { status: 'published' })).toEqual({
      title: 'Setting document status',
      detail: 'Published',
      icon: 'edit',
      tone: 'write',
    })
  })

  test('falls back to humanized unknown names', () => {
    expect(getToolCallDisplay('custom_tool_name', {})).toEqual({
      title: 'Running custom tool name',
      detail: '',
      icon: 'tool',
      tone: 'neutral',
    })
  })
})
