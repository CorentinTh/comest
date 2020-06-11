import {spawnSync} from 'child_process'
import {join} from 'path'
import {glob} from 'glob'
import {readFileSync, writeFileSync} from 'fs'
import {safeLoad} from 'js-yaml'
import tmp from 'tmp'
import {parseArgsStringToArgv} from "string-argv";
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

interface Config<T extends Asset> {
    name: string,
    path: string,
    command: string,
    assets: T[],
    expect: {
        stdout?: string,
        stderr?: string,
        status?: number
    }
}

interface SuiteResult {
    type: string,
    pass: boolean,
    expected: string | number,
    received: string | number
}

let validateConfig = (config) => {
    const isValid = config
        && config.command !== undefined
        && config.name !== undefined;

    if (!isValid) {
        throw `Config not valid: skipping the test suite: \n${JSON.stringify(config, null, 2)}`
    }

    return isValid ? config : undefined;
};

const getFilesContent = (baseDir: string): Config<Asset>[] => {
    const path = join(baseDir, 'test', '**/*.test.y?(a)ml')
    return glob
        .sync(path)
        .map(path => ({path, content: readFileSync(path, 'utf-8')}))
        .filter(c => c.content && c.content !== '')
        .map(({path, content}) => ({...safeLoad(content), path}))
        .map(validateConfig);
}

const createAssets = (assets) => {
    return assets.map(asset => {
        if (asset.type === 'file') {
            const file = tmp.fileSync()
            writeFileSync(file.name, asset.content);
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

const generateCommand = (config): string => {
    return config.command.replace(/\{(.*?)\}/g, (initial, name) => {
        const asset: Asset = config.assets.find(asset => asset.name === name);

        if (asset) {
            if (asset.type === 'file') {
                return (asset as AssetFile).file.name
            } else if (asset.type === 'string') {
                return asset.content
            }
        } else {
            throw `Cannot find asset "${name}" from "${config.command}". Currently available assets are: ${config.assets.map(asset => `"${asset.name}"`).join(', ')}`
        }

        return initial
    })
}

const executeCommand = (command: string) => {
    let args = parseArgsStringToArgv(command);
    let cmd = args.shift();

    return spawnSync(cmd, args, {
        cwd: process.cwd(),
        encoding: 'utf-8'
    })
}

const verifyExpectation = (result, expectations): SuiteResult[] => {
    return Object.entries(expectations).map(([key, value]) => {
        const input = result[key]

        return {
            type: key,
            pass: input === value,
            expected: value,
            received: input
        } as SuiteResult
    })
}

function formatResults(results: { result: SuiteResult[]; path: string; name: string }[]) {
    const splitter = `\n${'-'.repeat(10)}\n`;
    const suites = results
        .map(value => {
            let result = `Test suite: "${value.name}"`.bold + ` (file : ${value.path.replace(process.cwd(), '')})` + `\n\n`;

            result += value.result.map(suiteResult => {
                if(suiteResult.pass){
                    return `✓ ${suiteResult.type}: OK`.green
                } else {
                    return `✗ ${suiteResult.type}: FAILED`.red +`\n\nExpected:\n"${suiteResult.expected}"\n\nReceived:\n"${suiteResult.received}"\n`
                }
            }).join('\n')

            return result;
        })
        .join(splitter)

    const suitesCount = results.reduce((a, v) => (a += v.result.length), 0)
    const passingTests = results.reduce((a, v) => (a += v.result.reduce((a, v) => (a += v.pass ? 1 : 0), 0)), 0)
    const counter = `${passingTests}/${suitesCount}`;

    const global = splitter +
        `Tests results: ${passingTests === suitesCount ? counter.green : counter.red} assertions passing`.bold +
        '\n\n' +
        results.map(v => {
            const count = v.result.length
            const passing = v.result.reduce((a, v) => (a += v.pass ? 1 : 0), 0);

            return `Suite: '${v.name}' ${passing === count ? counter.green : counter.red}`
        }).join('\n') +
        splitter


    return {
        output: splitter + suites + splitter + '\n\n' + global,
        suitesCount,
        passingTests
    };

}

const comest = (dir: string) => {

    const result = getFilesContent(dir)
        .map((config) => {
            config.assets = createAssets(config.assets)
            const command = generateCommand(config);
            const commandResult = executeCommand(command);
            const result = verifyExpectation(commandResult, config.expect);

            removeAssets(config.assets);

            return {
                path: config.path,
                name: config.name,
                result
            };
        })

    const {output, suitesCount, passingTests} = formatResults(result)
    console.log(output)

    process.exit(suitesCount === passingTests ? 0 : 1);
}

export {comest};