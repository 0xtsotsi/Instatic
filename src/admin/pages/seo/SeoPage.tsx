/**
 * SeoPage — `/admin/tools/seo`.
 *
 * The SEO & AEO workspace: per-target metadata editing with live platform
 * previews (Meta tab), generated robots.txt with AI-crawler controls
 * (Robots.txt tab), and sitemap generation settings (Sitemap tab).
 *
 * Tab chrome uses the shared `Tabs` compound primitive (ARIA tabs with
 * automatic activation); the page owns the active value and the shared
 * workspace data (one `GET /seo/targets` load).
 *
 * Capabilities: `seo.read` gates the workspace (enforced by
 * `canAccessWorkspace`); `seo.manage` gates every write — tabs receive
 * `canManage` and disable their editing affordances with inline reasons.
 */

import { useState } from 'react'
import { Tabs, TabList, Tab, TabPanel } from '@ui/components/Tabs'
import { AdminPageLayout } from '@admin/layouts/AdminPageLayout'
import { hasCapability } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { MetaTab } from './tabs/MetaTab'
import { RobotsTab } from './tabs/RobotsTab'
import { SitemapTab } from './tabs/SitemapTab'
import { useSeoWorkspace } from './hooks/useSeoWorkspace'
import styles from './SeoPage.module.css'

type TabValue = 'meta' | 'robots' | 'sitemap'

export function SeoPage() {
  const currentUser = useCurrentAdminUser()
  const unrestricted = !currentUser
  const canManage = unrestricted || hasCapability(currentUser, 'seo.manage')

  const [tab, setTab] = useState<TabValue>('meta')
  const workspace = useSeoWorkspace()

  return (
    <Tabs value={tab} onChange={setTab}>
      <AdminPageLayout
        workspace="seo"
        title="SEO"
        titleId="seo-title"
        description="Search and answer-engine optimization: metadata, social cards, structured data, robots, and sitemap."
        tabs={
          <TabList ariaLabel="SEO sections">
            <Tab value="meta">Meta</Tab>
            <Tab value="robots">Robots.txt</Tab>
            <Tab value="sitemap">Sitemap</Tab>
          </TabList>
        }
        loading={workspace.loading}
      >
        {workspace.error ? (
          <p className={styles.loadError} role="alert">{workspace.error}</p>
        ) : (
          <div className={styles.body}>
            <TabPanel value="meta">
              <MetaTab workspace={workspace} canManage={canManage} />
            </TabPanel>
            <TabPanel value="robots">
              <RobotsTab workspace={workspace} canManage={canManage} />
            </TabPanel>
            <TabPanel value="sitemap">
              <SitemapTab workspace={workspace} canManage={canManage} />
            </TabPanel>
          </div>
        )}
      </AdminPageLayout>
    </Tabs>
  )
}
