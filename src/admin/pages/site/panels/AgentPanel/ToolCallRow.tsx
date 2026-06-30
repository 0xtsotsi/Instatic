import type { AgentToolCall } from '@site/agent'
import { LoaderIcon } from 'pixel-art-icons/icons/loader'
import { CheckIcon } from 'pixel-art-icons/icons/check'
import { CircleAlertSolidIcon } from 'pixel-art-icons/icons/circle-alert-solid'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import { EditSolidIcon } from 'pixel-art-icons/icons/edit-solid'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { FilePlusSolidIcon } from 'pixel-art-icons/icons/file-plus-solid'
import { CodeIcon } from 'pixel-art-icons/icons/code'
import { ColorsSwatchSolidIcon } from 'pixel-art-icons/icons/colors-swatch-solid'
import { ContainerSolidIcon } from 'pixel-art-icons/icons/container-solid'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { ImageSolidIcon } from 'pixel-art-icons/icons/image-solid'
import { UsersSolidIcon } from 'pixel-art-icons/icons/users-solid'
import { PackageSolidIcon } from 'pixel-art-icons/icons/package-solid'
import { MoveIcon } from 'pixel-art-icons/icons/move'
import { Copy2SolidIcon } from 'pixel-art-icons/icons/copy-2-solid'
import { OpenSolidIcon } from 'pixel-art-icons/icons/open-solid'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { LayoutSolidIcon } from 'pixel-art-icons/icons/layout-solid'
import { LinkIcon } from 'pixel-art-icons/icons/link'
import { RulerDimensionSolidIcon } from 'pixel-art-icons/icons/ruler-dimension-solid'
import { ZapSolidIcon } from 'pixel-art-icons/icons/zap-solid'
import { cn } from '@ui/cn'
import { getToolCallDisplay, type ToolCallIcon, type ToolCallTone } from './toolCallDisplay'
import styles from './AgentPanel.module.css'

export function ToolCallRow({ toolCall }: { toolCall: AgentToolCall }) {
  const isPending = toolCall.status === 'pending'
  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'error'

  const display = getToolCallDisplay(toolCall.actionType, toolCall.params)
  const accessibleStatus = isPending ? 'Running' : isSuccess ? 'Completed' : 'Failed'
  const detailLabel = display.detail ? ` - ${display.detail}` : ''
  const statusLabel = `${accessibleStatus} ${display.title}${detailLabel}`
  const iconToneClass = toolCallIconToneClass(display.tone)
  const statusClass = isPending
    ? styles.toolCallStatusPending
    : isSuccess
      ? styles.toolCallStatusSuccess
      : styles.toolCallStatusFailed

  // Surface the tool's error message directly in the row stream so the
  // user sees why a tool failed without opening devtools.
  const errorMessage = isError ? toolCall.result?.error ?? 'Tool call failed.' : null

  return (
    <>
      <div
        role="status"
        aria-label={statusLabel}
        className={cn(
          styles.toolCallRow,
          isPending ? styles.toolCallRowPending : null,
          isError ? styles.toolCallRowFailed : null,
        )}
      >
        <span className={cn(styles.toolCallIcon, iconToneClass)} aria-hidden="true">
          <ToolCallLeadingIcon icon={display.icon} />
        </span>
        <span className={styles.toolCallCopy} aria-hidden="true">
          <span className={styles.toolCallTitle}>{display.title}</span>
          {display.detail && <span className={styles.toolCallDetail}>{display.detail}</span>}
        </span>
        <span className={cn(styles.toolCallStatus, statusClass)} aria-hidden="true">
          {isPending ? (
            <LoaderIcon size={11} />
          ) : isSuccess ? (
            <CheckIcon size={11} />
          ) : (
            <CircleAlertSolidIcon size={11} />
          )}
        </span>
      </div>
      {errorMessage && (
        <p
          role="alert"
          className={styles.toolCallError}
        >
          {errorMessage}
        </p>
      )}
    </>
  )
}

function ToolCallLeadingIcon({ icon }: { icon: ToolCallIcon }) {
  switch (icon) {
    case 'add':
      return <FilePlusSolidIcon size={16} />
    case 'class':
      return <LinkIcon size={16} />
    case 'code':
      return <CodeIcon size={16} />
    case 'collection':
      return <PackageSolidIcon size={16} />
    case 'copy':
      return <Copy2SolidIcon size={16} />
    case 'data':
      return <DatabaseSolidIcon size={16} />
    case 'delete':
      return <TrashSolidIcon size={16} />
    case 'document':
      return <FileTextSolidIcon size={16} />
    case 'edit':
      return <EditSolidIcon size={16} />
    case 'media':
      return <ImageSolidIcon size={16} />
    case 'move':
      return <MoveIcon size={16} />
    case 'node':
      return <ContainerSolidIcon size={16} />
    case 'open':
      return <OpenSolidIcon size={16} />
    case 'page':
      return <FileTextSolidIcon size={16} />
    case 'preview':
      return <EyeSolidIcon size={16} />
    case 'runtime':
      return <RulerDimensionSolidIcon size={16} />
    case 'style':
      return <ColorsSwatchSolidIcon size={16} />
    case 'template':
      return <LayoutSolidIcon size={16} />
    case 'tokens':
      return <ColorsSwatchSolidIcon size={16} />
    case 'users':
      return <UsersSolidIcon size={16} />
    case 'tool':
      return <ZapSolidIcon size={16} />
  }
}

function toolCallIconToneClass(tone: ToolCallTone): string {
  switch (tone) {
    case 'danger':
      return styles.toolCallIconDanger
    case 'read':
      return styles.toolCallIconRead
    case 'style':
      return styles.toolCallIconStyle
    case 'write':
      return styles.toolCallIconWrite
    case 'neutral':
      return styles.toolCallIconNeutral
  }
}
