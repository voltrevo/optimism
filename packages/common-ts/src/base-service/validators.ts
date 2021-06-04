export type ValidationFunction = (val: any) => boolean
export type EnvVarParsingFunction = (val: string) => any

export const validate: {
  [name: string]: ValidationFunction
} = {
  uint: (val: any) => {
    return Number.isInteger(val) && val >= 0
  },
}

export const parse: {
  [name: string]: EnvVarParsingFunction
} = {
  uint: (val: string) => {
    return parseInt(val, 10)
  }
}
