import {spawnSync} from 'child_process'
import {join} from 'path'
import {glob} from 'glob'
import {chmodSync, readFileSync, writeFileSync} from 'fs'
import {safeLoad} from 'js-yaml'
import tmp from 'tmp'
import 'colors'

interface Asset {
    type: 'string' | 'file',
    name: string,
    content: string
}

interface AssetFile {
    type: 'string' | 'file',
    name: string,
    content: string,
    file: {
        removeCallback: Function,
        name: string
    }
}

interface ConfigSimple {
    name: string,
    path: string,
    command: string,
    assets: Asset[],
    expect: {
        stdout?: string,
        stderr?: string,
        status?: number
    }
}

interface ConfigSteps {
    name: string,
    path: string,
    assets: Asset[],
    steps: {
        command: string,
        expect: {
            stdout?: string,
            stderr?: string,
            status?: number
        }
    }[]
}

type Config = ConfigSimple | ConfigSteps;

interface SuiteResult {
    command: string,
    type: string,
    pass: boolean,
    expected: string | number,
    received: string | number
}

let normalizeConfig = (config: Config): ConfigSteps => {
    if (config && config.name !== undefined) {
        if (!("steps" in config)) {
            (config as unknown as ConfigSteps).steps = [{
                command: config.command,
                expect: config.expect,
            }];
        }

        if (!config.assets) {
            config.assets = [];
        }

        return (config as unknown as ConfigSteps);
    } else {
        throw `Config not valid: skipping the test suite: \n${JSON.stringify(config, null, 2)}`
    }

};

const getConfigs = (baseDir: string): ConfigSteps[] => {
    const path = join(baseDir, 'test', '**/*.test.y?(a)ml')
    return glob
        .sync(path)
        .map(path => ({path, content: readFileSync(path, 'utf-8')}))
        .filter(c => c.content && c.content !== '')
        .map(({path, content}) => ({...safeLoad(content), path}))
        .map(normalizeConfig);
}

const createAssets = (assets) => {
    return assets.map(asset => {
        if (asset.type === 'file') {
            const extension = /(?:\.([^.]+))?$/.exec(asset.name)[1];
            const postfix = extension ? '.' + extension : ''

            const file = tmp.fileSync({postfix, mode:0o755, discardDescriptor: true });
            writeFileSync(file.name, asset.content ?? '');
            asset.file = file;
        }

        return asset;
    })
}

const removeAssets = (assets) => {
    return assets.forEach(asset => {
        if (asset.type === 'file' && asset.file) {
            asset.file.removeCallback();
        }
    })
}

const generateCommand = (command: string, assets: Asset[], name: string): string => {
    return command.replace(/\{(.*?)\}/g, (initial, name) => {
        const asset: Asset = assets.find(asset => asset.name === name);

        if (asset) {
            if (asset.type === 'file') {
                return (asset as AssetFile).file.name
            } else if (asset.type === 'string') {
                return `"${asset.content}"`
            }
        } else {
            throw `Cannot find asset "${name}" from "${command}" in file ${name}`
        }

        return initial
    })
}

const executeCommand = (command: string) => {
    return spawnSync(command, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        shell: true
    })
}

const verifyExpectation = (result, expectations): SuiteResult[] => {
    return expectations ? Object.entries(expectations).map(([key, value]) => {
        let input = result[key]

        if (typeof input === 'string') {
            input = input.trim();
        }

        return {
            type: key,
            pass: input === value,
            expected: value,
            received: input ?? ''
        } as SuiteResult
    }) : [];
}

function formatResults(results: { result: { result: SuiteResult[]; command: string }[]; path: string; name: string }[]) {
    const splitter = `\n${'-'.repeat(10)}\n`;
    const suites = results
        .map(value => {
            let result = `Test suite: "${value.name}"`.bold + ` (file : ${value.path.replace(process.cwd(), '')})` + `\n\n`;

            result += value.result.map(suiteInfo => {
                return '-> ' + suiteInfo.command + (suiteInfo.result.length > 0 ? '\n' : '') + suiteInfo.result.map(results => {
                    if (results.pass) {
                        return `✓ ${results.type}: OK`.green
                    } else {
                        return `✗ ${results.type}: FAILED`.red + `\n\nExpected:\n"${results.expected}"\n\nReceived:\n"${results.received}"\n`
                    }
                }).join('\n') + '\n';


            }).join('\n')

            return result;
        })
        .join(splitter)

    const suitesCount = results.reduce((a, v) => (a += v.result.reduce((a, v) => (a += v.result.length), 0)), 0)
    const passingTests = results.reduce((a, v) => (a += v.result.reduce((a, v) => (a += v.result.reduce((a, v) => (a += v.pass ? 1 : 0), 0)), 0)), 0);
    const counter = `${passingTests}/${suitesCount}`;

    const global = splitter +
        `Tests results: ${passingTests === suitesCount ? counter.green : counter.red} assertions passing in ${results.length} files.`.bold +
        '\n\n' +
        results.map(v => {
            const pass = v.result.every((v) => v.result.every(v => v.pass));

            return ((pass ? '✓'.green : '✗'.red) + ` Suite: '${v.name}'`)
        }).join('\n') +
        splitter


    return {
        output: splitter + suites + splitter + '\n\n' + global,
        suitesCount,
        passingTests
    };

}

const comest = (dir: string) => {

    try {
        const result = getConfigs(dir)
            .map((config) => {
                config.assets = createAssets(config.assets)

                const suiteResult = config.steps.map(step => {

                    const command = generateCommand(step.command, config.assets, config.path.replace(process.cwd(), ''));
                    const commandResult = executeCommand(command);
                    const result = verifyExpectation(commandResult, step.expect);

                    return {
                        result,
                        command: step.command
                    };
                })

                removeAssets(config.assets);
                return {
                    path: config.path,
                    name: config.name,
                    result: suiteResult
                };
            })

        const {output, suitesCount, passingTests} = formatResults(result)
        console.log(output)

        process.exit(suitesCount === passingTests ? 0 : 1);
    } catch (e) {
        console.log(e);
        console.log('An error occured while parsing the test files.\n\n' + e.toString().red);
        process.exit(1);
    }

}

export {comest};