import { z } from 'zod'

const outpointSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}:\d+$/)

export const inscriptionIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}i\d+$/)

export const ordOutputSchema = z.looseObject({
  outpoint: outpointSchema,
  value: z.number().int().nonnegative(),
  spent: z.boolean(),
  inscriptions: z.array(inscriptionIdSchema).nullable().optional(),
  runes: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .nullable()
    .optional(),
  script_pubkey: z.string().optional(),
  address: z.string().nullable().optional(),
  confirmations: z.number().int().optional(),
})

export const ordOutputsResponseSchema = z.array(ordOutputSchema)

export const ordInscriptionSchema = z.looseObject({
  id: inscriptionIdSchema,
  number: z.number().int().nullable().optional(),
  satpoint: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}:\d+:\d+$/),
  value: z.number().int().nonnegative().nullable().optional(),
  content_type: z.string().nullable().optional(),
  effective_content_type: z.string().nullable().optional(),
  charms: z.array(z.string()).nullable().optional(),
  parents: z.array(inscriptionIdSchema).nullable().optional(),
  height: z.number().int().nullable().optional(),
  timestamp: z.number().int().nullable().optional(),
})

export const ordInscriptionsResponseSchema = z.array(ordInscriptionSchema)

export type OrdOutput = z.infer<typeof ordOutputSchema>
export type OrdInscription = z.infer<typeof ordInscriptionSchema>

export type OrdOutputType = 'cardinal' | 'inscribed' | 'runic' | 'any'
