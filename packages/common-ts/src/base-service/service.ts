/* Imports: External */
import Config from 'bcfg'
import * as dotenv from 'dotenv'
import { cloneDeep } from 'lodash'

/* Imports: Internal */
import { Logger } from '../common/logger'
import { TypingFunction } from './types'

type OptionSettings<TOptions> = {
  [P in keyof TOptions]?: {
    default?: TOptions[P]
    type?: TypingFunction
  }
}

export abstract class Service<TServiceOptions, TServiceParsedOptions, TServiceState> {
  protected logger: Logger
  protected options: TServiceParsedOptions
  protected state: TServiceState

  constructor(params: {
    name: string
    options: Partial<TServiceOptions>
    optionSettings?: OptionSettings<TServiceOptions>
    state: TServiceState
  }) {
    dotenv.config()
    const config = new Config(params.name)
    config.load({
      env: true,
      argv: true,
    })

    this.options = params.options as TServiceParsedOptions
    for (const optionName of Object.keys(params.optionSettings || {})) {
      const optionValue = this.options[optionName]
      const optionSettings = params.optionSettings[optionName]

      if (optionValue === undefined) {
        if (optionSettings.validator) {
          this.options[optionName] = optionSettings.validator.parse(
            config.str(optionName)
          )
        }

        if (optionSettings.default) {
          this.options[optionName] = cloneDeep(optionSettings.default)
        } else {
          throw new Error(
            `value for option "${optionName}" was undefined but no default was specified`
          )
        }
      }

      if (optionSettings.validator) {
        if (!optionSettings.validator.validate(optionValue)) {
          throw new Error(
            `value for option "${optionName}" is invalid: ${optionValue}`
          )
        }
      }
    }

    this.logger = new Logger({ name: params.name })
  }

  public run(): void {
    const _run = async () => {
      if (this.init) {
        this.logger.info('initializing service')
        await this.init()
        this.logger.info('service initialized')
      }

      this.logger.info('starting main loop')
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

  protected abstract init?(): Promise<void>
  protected abstract main(): Promise<void>
}
