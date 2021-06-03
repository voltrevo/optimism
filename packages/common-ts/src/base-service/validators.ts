export type ValidationFunction = (val: any) => boolean

export const validate: {
  [name: string]: ValidationFunction
} = {
  integer: (val: any) => {
    return Number.isInteger(val)
  },
}
