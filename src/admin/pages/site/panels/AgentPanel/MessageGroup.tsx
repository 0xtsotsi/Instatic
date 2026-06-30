import { renderMarkdownToHtml, type AgentMessage, type AgentToolCall } from '@site/agent'
import { cn } from '@ui/cn'
import { ToolCallRow } from './ToolCallRow'
import styles from './AgentPanel.module.css'

interface ConversationMessageGroup {
  role: AgentMessage['role']
  messages: AgentMessage[]
}

export function MessageGroups({ messages }: { messages: AgentMessage[] }) {
  const groups = groupConversationMessages(messages)

  return (
    <>
      {groups.map((group) => (
        <MessageGroup key={group.messages[0]?.id ?? group.role} group={group} />
      ))}
    </>
  )
}

function groupConversationMessages(messages: AgentMessage[]): ConversationMessageGroup[] {
  const groups: ConversationMessageGroup[] = []
  for (const message of messages) {
    const previousGroup = groups.at(-1)
    if (previousGroup && previousGroup.role === message.role) {
      previousGroup.messages.push(message)
      continue
    }
    groups.push({ role: message.role, messages: [message] })
  }
  return groups
}

function MessageGroup({ group }: { group: ConversationMessageGroup }) {
  const isUser = group.role === 'user'
  const items = flattenGroupBlocks(group.messages)

  return (
    <div className={cn(styles.messageEntry, isUser ? styles.messageEntryUser : styles.messageEntryAssistant)}>
      <div className={styles.roleLabel}>
        {isUser ? 'You' : 'Assistant'}
      </div>

      {items.map((item) =>
        item.kind === 'text' ? (
          <MarkdownTextBlock key={item.key} text={item.text} isUser={isUser} />
        ) : (
          <div key={item.key} className={styles.toolCallsContainer}>
            {item.toolCalls.map((toolCall) => (
              <ToolCallRow key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        ),
      )}
    </div>
  )
}

type RenderItem =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tools'; key: string; toolCalls: AgentToolCall[] }

// Coalesce runs of consecutive tool-call blocks into a single container so
// stacked tools sit tight (flex gap), while text blocks stay separate items
// that the message grid spaces apart. Runs span across messages of the same
// role, since the agent emits multiple tool calls as separate messages.
function flattenGroupBlocks(messages: AgentMessage[]): RenderItem[] {
  const items: RenderItem[] = []
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === 'text') {
        items.push({ kind: 'text', key: textBlockRenderKey(message.id, block.text), text: block.text })
        continue
      }
      const last = items.at(-1)
      if (last && last.kind === 'tools') {
        last.toolCalls.push(block.toolCall)
        continue
      }
      items.push({ kind: 'tools', key: `${message.id}-${block.toolCall.id}`, toolCalls: [block.toolCall] })
    }
  }
  return items
}

function textBlockRenderKey(messageId: string, text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${messageId}-text-${(hash >>> 0).toString(36)}`
}

interface MarkdownTextBlockProps {
  text: string
  isUser: boolean
}

function MarkdownTextBlock({
  text,
  isUser,
}: MarkdownTextBlockProps) {
  const html = renderMarkdownToHtml(text)
  if (!html) return null
  return (
    <div
      className={cn(
        styles.textBlock,
        isUser ? styles.textBlockUser : styles.textBlockAssistant,
        styles.markdownText,
      )}
      // Safe: sanitised by DOMPurify (via sanitizeRichtext) before reaching here.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
