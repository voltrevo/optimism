/* Imports: External */
import { ethers } from 'ethers'

export type TypingFunction<TParsedType> = {
  parse: (val: string) => TParsedType
  validate: (val: TParsedType) => boolean
}
export type TypingFunctionGenerator<TArgs extends Array<any>, TParsedType> = (
  ...args: TArgs
) => TypingFunction<TParsedType>

export const types: {
  int: TypingFunction<number>
  uint: TypingFunction<number>
  string: TypingFunction<string>
  address: TypingFunction<string>
  bytes32: TypingFunction<string>
  JsonRpcProvider: TypingFunction<ethers.providers.JsonRpcProvider>
  Contract: TypingFunctionGenerator<[ethers.utils.Interface], ethers.Contract>
  Wallet: TypingFunction<ethers.Wallet>
} = {
  int: {
    parse: (val) => {
      return parseInt(val, 10)
    },
    validate: (val) => {
      return Number.isInteger(val)
    },
  },
  uint: {
    parse: (val) => {
      return types.int.parse(val)
    },
    validate: (val) => {
      return types.int.validate(val) && val >= 0
    },
  },
  string: {
    parse: (val) => {
      return val
    },
    validate: (val) => {
      return typeof val === 'string'
    },
  },
  address: {
    parse: (val) => {
      return types.string.parse(val)
    },
    validate: (val) => {
      return ethers.utils.isAddress(val)
    },
  },
  bytes32: {
    parse: (val) => {
      return types.string.parse(val)
    },
    validate: (val) => {
      return ethers.utils.isHexString(val, 32)
    },
  },
  JsonRpcProvider: {
    parse: (val) => {
      return new ethers.providers.JsonRpcProvider(val)
    },
    validate: (val) => {
      return true // TODO
    },
  },
  Contract: (iface) => {
    return {
      parse: (val) => {
        return new ethers.Contract(val, iface)
      },
      validate: (val) => {
        return true // TODO
      },
    }
  },
  Wallet: {
    parse: (val) => {
      return new ethers.Wallet(val)
    },
    validate: (val) => {
      return true // TODO
    },
  },
}
