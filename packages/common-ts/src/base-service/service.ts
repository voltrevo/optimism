/* Imports: Internal */
import { Logger } from '../common/logger'
import { Metrics } from '../common/metrics'
import { ValidationFunction, validate } from './validators'

type OptionSettings<TOptions> = {
  [P in keyof TOptions]?: {
    required?: boolean
    default?: TOptions[P]
    validate?: ValidationFunction
  }
}

abstract class Service<TServiceOptions> {
  protected logger: Logger
  protected options: TServiceOptions

  constructor(params: {
    name: string
    options: TServiceOptions
    optionSettings?: OptionSettings<TServiceOptions>
  }) {
    this.options = mergeEnvironmentOptions(params.options, params.optionSettings)
    validateOptions(this.options, params.optionSettings || {})
    this.options = mergeDefaultOptions(this.options, params.optionSettings)
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

/**
 * Combines user provided and default options.
 */
function mergeDefaultOptions<T>(
  options: T,
  optionSettings: OptionSettings<T>
): T {
  for (const optionName of Object.keys(optionSettings)) {
    const optionDefault = optionSettings[optionName].default
    if (optionDefault === undefined) {
      continue
    }

    if (options[optionName] !== undefined && options[optionName] !== null) {
      continue
    }

    options[optionName] = optionDefault
  }

  return options
}

/**
 * Combines user provided and default options.
 */
function mergeEnvironmentOptions<T>(
  options: T,
  optionSettings: OptionSettings<T>
): T {
  for (const optionName of Object.keys(optionSettings)) {
    const optionDefault = optionSettings[optionName].default
    if (optionDefault === undefined) {
      continue
    }

    if (options[optionName] !== undefined && options[optionName] !== null) {
      continue
    }

    options[optionName] = optionDefault
  }

  return options
}

/**
 * Performs option validation against the option settings
 */
function validateOptions<T>(options: T, optionSettings: OptionSettings<T>) {
  for (const optionName of Object.keys(optionSettings)) {
    const optionSetting = optionSettings[optionName]
    const optionValue = options[optionName]

    if (optionSetting.required && optionValue === undefined) {
      throw new Error(
        `a value for option "${optionName}" is required but no value was given`
      )
    }

    if (
      optionSetting.validate &&
      optionSetting.validate(optionValue) === false
    ) {
      throw new Error(
        `value for option "${optionName}" is invalid: ${optionValue}`
      )
    }
  }
}

interface MyServiceOptions {
  myOption: number
}

class MyService extends Service<MyServiceOptions> {
  constructor(options: MyServiceOptions) {
    super({
      name: 'my-service',
      options,
      optionSettings: {
        myOption: {
          required: true,
          default: 12345,
          validate: validate.integer,
        },
      },
    })
  }

  async init() {}

  async main() {
    process.exit(0)
  }
}

const service = new MyService({
  myOption: 123,
})

service.run()
