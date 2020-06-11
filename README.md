# comest

Small and lightweight cli-testing framework.

## Installation
You can run `comest` without installing it by using `npx`:
```shell
npx comest
``` 
Or you can install it by running:
```shell
npm i -g comest

# use it by typing
comest
```

## Usage
Create test files matching `*.test.yml` like `myFile.test.yml`

### File structure

This test run the command `echo foo` and checks 'yo' has been printed on stdout.
```yaml
name: Simple echo test
command: echo foo
expect:
  status: 0
  stdout: foo
```

This test run the command `echo foo && exit 42` and checks 'yo' has been printed on stdout and return value is 42.
```yaml
name: Simple echo test
command: echo foo && exit 42
expect:
  status: 42
  stdout: foo
```

This test will create a tmp file containing "Lorem ipsum" and will replace `{file1}` with the absolute path of the tmp file ni the command, and execute it. It will then compare the result of the command with the things in **expect**.  

```yaml
name: mon test
command: cat {file1}
assets:
  - type: file
    name: file1
    content: Lorem ipsum
expect:
  status: 0
  stdout: Lorem ipsum
```
This test will fail because the expectation is different
```yaml
name: mon test
command: cat {file1}
assets:
  - type: file
    name: file1
    content: Lorem ipsum
expect:
  status: 0
  stdout: dolor sit amet
```