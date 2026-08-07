const defaultEnv = ["LANG=en_US.UTF-8", "LANGUAGE=en_US:en", "LC_ALL=en_US.UTF-8"]

export const languageConfigs: Record<string, Record<string, unknown>> = {
  C: {
    template: "",
    compile: {
      src_name: "main.c",
      exe_name: "main",
      max_cpu_time: 3000,
      max_real_time: 10000,
      max_memory: 256 * 1024 * 1024,
      compile_command:
        "/usr/bin/gcc -DONLINE_JUDGE -O2 -w -fmax-errors=3 -std=c17 {src_path} -lm -o {exe_path}",
    },
    run: {
      command: "{exe_path}",
      seccomp_rule: { "Standard IO": "c_cpp", "File IO": "c_cpp_file_io" },
      env: defaultEnv,
    },
  },
  "C++": {
    template: "",
    compile: {
      src_name: "main.cpp",
      exe_name: "main",
      max_cpu_time: 10000,
      max_real_time: 20000,
      max_memory: 1024 * 1024 * 1024,
      compile_command:
        "/usr/bin/g++ -DONLINE_JUDGE -O2 -w -fmax-errors=3 -std=c++20 {src_path} -lm -o {exe_path}",
    },
    run: {
      command: "{exe_path}",
      seccomp_rule: { "Standard IO": "c_cpp", "File IO": "c_cpp_file_io" },
      env: defaultEnv,
    },
  },
  Java: {
    template: "",
    compile: {
      src_name: "Main.java",
      exe_name: "Main",
      max_cpu_time: 5000,
      max_real_time: 10000,
      max_memory: -1,
      compile_command: "/usr/bin/javac {src_path} -d {exe_dir}",
    },
    run: {
      command: "/usr/bin/java -cp {exe_dir} -XX:MaxRAM={max_memory}k Main",
      seccomp_rule: null,
      env: defaultEnv,
      memory_limit_check_only: 1,
    },
  },
  Python3: {
    template: "",
    compile: {
      src_name: "solution.py",
      exe_name: "solution.py",
      max_cpu_time: 3000,
      max_real_time: 10000,
      max_memory: 128 * 1024 * 1024,
      compile_command: "/usr/bin/python3 -m py_compile {src_path}",
    },
    run: {
      command: "/usr/bin/python3 -BS {exe_path}",
      seccomp_rule: "general",
      env: defaultEnv,
    },
  },
  Golang: {
    template: "",
    compile: {
      src_name: "main.go",
      exe_name: "main",
      max_cpu_time: 3000,
      max_real_time: 5000,
      max_memory: 1024 * 1024 * 1024,
      compile_command: "/usr/bin/go build -o {exe_path} {src_path}",
      env: ["GOCACHE=/tmp", "GOPATH=/tmp", "GOMAXPROCS=1", ...defaultEnv],
    },
    run: {
      command: "{exe_path}",
      seccomp_rule: "golang",
      env: ["GOMAXPROCS=1", ...defaultEnv],
      memory_limit_check_only: 1,
    },
  },
  JavaScript: {
    template: "",
    compile: {
      src_name: "main.js",
      exe_name: "main.js",
      max_cpu_time: 3000,
      max_real_time: 5000,
      max_memory: 1024 * 1024 * 1024,
      compile_command: "/usr/bin/node --check {src_path}",
      env: defaultEnv,
    },
    run: {
      command: "/usr/bin/node {exe_path}",
      seccomp_rule: "node",
      env: defaultEnv,
      memory_limit_check_only: 1,
    },
  },
}
