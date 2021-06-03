/* Imports: Internal */
import { Logger } from '../common/logger'
import { Metrics } from '../common/metrics'

type OptionSettings<TOptions> = {
  [P in keyof TOptions]?: {
    default?: TOptions[P]
    validate?: (val: any) => boolean
  }
}

/**
 * Base for other "Service" objects. Handles your standard initialization process, can dynamically
 * start and stop.
 */
export abstract class BaseService<T> {
  protected name: string
  protected options: T
  protected logger: Logger
  protected metrics: Metrics
  protected initialized: boolean = false
  protected running: boolean = false

  constructor(name: string, options: T, optionSettings: OptionSettings<T>) {
    validateOptions(options, optionSettings)
    this.name = name
    this.options = mergeDefaultOptions(options, optionSettings)
    this.logger = new Logger({ name })
  }

  /**
   * Initializes the service.
   */
  public async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    this.logger.info('Service is initializing...')
    await this._init()
    this.logger.info('Service has initialized.')
    this.initialized = true
  }

  /**
   * Starts the service (initializes it if needed).
   */
  public async start(): Promise<void> {
    if (this.running) {
      return
    }
    this.logger.info('Service is starting...')
    await this.init()

    // set the service to running
    this.running = true

    // await this._onStart()

    while (this.running) {
      try {
        await this._main()
      } catch (err) {
        this.logger.error('caught an unhandled exception', {
          message: err.message,
          stack: err.stack,
          code: err.code,
        })
      }
    }
  }

  /**
   * Stops the service.
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      return
    }

    // await this._onStart()
    this.running = false
    this.logger.info('service has stopped')
  }

  abstract _start(): Promise<void>
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
 * Performs option validation against the option settings
 */
function validateOptions<T>(options: T, optionSettings: OptionSettings<T>) {
  for (const optionName of Object.keys(optionSettings)) {
    const optionValidationFunction = optionSettings[optionName].validate
    if (optionValidationFunction === undefined) {
      continue
    }

    const optionValue = options[optionName]

    if (optionValidationFunction(optionValue) === false) {
      throw new Error(
        `Provided input for option "${optionName}" is invalid: ${optionValue}`
      )
    }
  }
}
