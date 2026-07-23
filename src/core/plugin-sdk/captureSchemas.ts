/**
 * Shared schemas and types for the plugin-facing URL capture API.
 */
import { Type, type Static } from '@core/utils/typeboxHelpers'

export const CaptureInputSchema = Type.Object(
  {
    url: Type.String({
      pattern: '^https?://',
      description: 'Absolute http(s) URL to capture.',
    }),
    mode: Type.Optional(
      Type.Union([
        Type.Literal('dom+styles'),
        Type.Literal('dom-only'),
        Type.Literal('styles-only'),
      ]),
    ),
    scope: Type.Optional(
      Type.Union([
        Type.Literal('page'),
        Type.Literal('subtree'),
        Type.Literal('element'),
      ]),
    ),
    selector: Type.Optional(Type.String({ maxLength: 500 })),
    assetsMax: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    interactions: Type.Optional(
      Type.Array(
        Type.Object(
          {
            action: Type.Union([
              Type.Literal('click'),
              Type.Literal('fill'),
              Type.Literal('type'),
              Type.Literal('hover'),
              Type.Literal('wait_for'),
              Type.Literal('wait_for_url'),
              Type.Literal('wait'),
              Type.Literal('press'),
            ]),
            selector: Type.Optional(Type.String()),
            value: Type.Optional(Type.String()),
            text: Type.Optional(Type.String()),
            pattern: Type.Optional(Type.String()),
            key: Type.Optional(Type.String()),
            ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 30_000 })),
            timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
            delayMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5_000 })),
          },
          { additionalProperties: false },
        ),
        { maxLength: 50 },
      ),
    ),
  },
  { additionalProperties: false },
)

export type CaptureInput = Static<typeof CaptureInputSchema>

export const CaptureOutputSchema = Type.Object(
  {
    ok: Type.Boolean(),
    error: Type.Optional(Type.String()),
    html: Type.Optional(Type.String()),
    css: Type.Optional(Type.String()),
    uids: Type.Optional(Type.Array(Type.String())),
    assetFiles: Type.Optional(Type.Array(Type.Object({
      localPath: Type.String(),
      originalUrl: Type.String(),
    }))),
    unavailable: Type.Optional(Type.Array(Type.Object({
      url: Type.String(),
      reason: Type.String(),
    }))),
    nextActions: Type.Optional(Type.Array(Type.Object({
      tool: Type.String(),
      input: Type.Record(Type.String(), Type.Unknown()),
      description: Type.String(),
    }))),
  },
  { additionalProperties: false },
)

export type CaptureOutput = Static<typeof CaptureOutputSchema>
