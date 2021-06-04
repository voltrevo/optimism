/* Imports: External */
import { ethers } from 'ethers'

export type TypingFunction = {
  parse: (val: string) => any
  validate: (val: any) => boolean
}
export type TypingFunctionGenerator = (...args: any[]) => TypingFunction

export const types: {
  [name: string]: TypingFunction | TypingFunctionGenerator
} = {
  number: {
    parse: (val) => {
      return parseInt(val, 10)
    },
    validate: (val) => {
      return Number.isInteger(val) && val >= 0
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
      return val
    },
    validate: (val: any) => {
      return ethers.utils.isAddress(val)
    },
  },
  bytes32: {
    parse: (val) => {
      return val
    },
    validate: (val: any) => {
      return ethers.utils.isHexString(val, 32)
    },
  },
  JsonRpcProvider: {
    parse: (val) => {
      return new ethers.providers.JsonRpcProvider(val)
    },
    validate: (val: any) => {
      return true
    },
  },
  Contract: (iface: ethers.utils.Interface) => {
    return {
      parse: (val) => {
        return new ethers.Contract(val, iface)
      },
      validate: (val: any) => {
        return true
      },
    }
  },
  Wallet: {
    parse: (val) => {
      return new ethers.Wallet(val)
    },
    validate: (val: any) => {
      return ethers.utils.isHexString(val, 32)
    },
  },
}
