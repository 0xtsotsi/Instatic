/**
 * AiPage — `/admin/ai`.
 *
 * Capability-gated workspace for managing AI provider credentials, per-scope
 * defaults, and (Phase 6) the AI usage audit log.
 *
 * Layout mirrors UsersPage — three tabs, each owning its own state. The
 * page itself is thin: it figures out which tabs the current admin can
 * see, loads minimal data, and delegates rendering to per-tab components.
 *
 * Capabilities consulted:
 *   - `ai.providers.manage`  → Providers + Defaults tabs (CRUD)
 *   - `ai.audit.read`        → Audit tab (read site-wide usage)
 */

import { useState } from 'react'
import { Tab, TabList, TabPanel, Tabs } from '@ui/components/Tabs'
import { AdminPageLayout } from '@admin/layouts/AdminPageLayout'
import { hasCapability } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { ProvidersTab } from './tabs/ProvidersTab'
import { DefaultsTab } from './tabs/DefaultsTab'
import { AuditTab } from './tabs/AuditTab'
import { McpTab } from './tabs/McpTab'
import styles from './AiPage.module.css'

type AiTab = 'providers' | 'defaults' | 'mcp' | 'audit'

const TAB_LABELS: Record<AiTab, string> = {
  providers: 'Providers',
  defaults: 'Defaults',
  mcp: 'MCP',
  audit: 'Audit',
}

export function AiPage() {
  const currentUser = useCurrentAdminUser()
  const unrestricted = !currentUser
  const canManage = unrestricted || hasCapability(currentUser, 'ai.providers.manage')
  const canReadAudit = unrestricted || hasCapability(currentUser, 'ai.audit.read')

  const availableTabs: AiTab[] = []
  if (canManage) availableTabs.push('providers', 'defaults', 'mcp')
  if (canReadAudit) availableTabs.push('audit')

  const [tab, setTab] = useState<AiTab>('providers')
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0] ?? 'providers'

  const tabs = (
    <TabList ariaLabel="AI sections">
      {availableTabs.map((item) => (
        <Tab key={item} value={item} testId={`ai-tab-${item}`}>
          <span>{TAB_LABELS[item]}</span>
        </Tab>
      ))}
    </TabList>
  )

  return (
    <Tabs value={activeTab} onChange={setTab}>
      <AdminPageLayout
        workspace="ai"
        title="AI"
        titleId="ai-title"
        description="Configure AI provider credentials, per-scope defaults, and review usage."
        tabs={tabs}
      >
        <div className={styles.body}>
          <TabPanel value="providers"><ProvidersTab /></TabPanel>
          <TabPanel value="defaults"><DefaultsTab /></TabPanel>
          <TabPanel value="mcp"><McpTab /></TabPanel>
          <TabPanel value="audit"><AuditTab /></TabPanel>
        </div>
      </AdminPageLayout>
    </Tabs>
  )
}
