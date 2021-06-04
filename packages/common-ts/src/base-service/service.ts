/* Imports: External */
import { Bcfg } from '@eth-optimism/core-utils'
import Config from 'bcfg'
import * as dotenv from 'dotenv'
import { cloneDeep } from 'lodash'

/* Imports: Internal */
import { Logger } from '../common/logger'
import { ValidationFunction, EnvVarParsingFunction } from './validators'

type OptionSettings<TOptions> = {
  [P in keyof TOptions]?: {
    default?: TOptions[P]
    parse?: EnvVarParsingFunction
    validate?: ValidationFunction
  }
}

export abstract class Service<TServiceOptions> {
  protected logger: Logger
  protected options: TServiceOptions

  constructor(params: {
    name: string
    options: TServiceOptions
    optionSettings?: OptionSettings<TServiceOptions>
  }) {
    dotenv.config()
    const config: Bcfg = new Config(params.name)
    config.load({
      env: true,
      argv: true,
    })

    this.options = params.options
    for (const optionName of Object.keys(params.optionSettings || {})) {
      const optionValue = this.options[optionName]
      const optionSettings = params.optionSettings[optionName]

      if (optionValue === undefined) {
        if (optionSettings.parse) {
          this.options[optionName] = optionSettings.parse(config.str(optionName))
        }

        if (optionSettings.default) {
          this.options[optionName] = cloneDeep(optionSettings.default)
        } else {
          throw new Error(`value for option "${optionName}" was undefined but no default was specified`)
        }
      }

      if (optionSettings.validate) {
        if (!optionSettings.validate(optionValue)) {
          throw new Error(`value for option "${optionName}" is invalid: ${optionValue}`)
        }
      }
    }

    this.logger = new Logger({ name: params.name })
  }

  public run(): void {
    const _run = async () => {
      this.logger.info('initializing service')
      await this.init()
      this.logger.info('service initialized')

      while (true) {
        try {
          await this.main()
        } catch (err) {
          this.logger.error('caught an unhandled exception', {
            message: err.message,
            stack: err.stack,
            code: err.code,
          })
        }
      }
    }

    _run()
  }

  protected abstract init(): Promise<void>
  protected abstract main(): Promise<void>
}
