#cat > CMakeLists.txt << 'EOF'
cmake_minimum_required(VERSION 3.16)
project(CodeMetricsAnalyzer VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if (MSVC)
    add_compile_options(/W4 /WX)
else()
    add_compile_options(-Wall -Wextra -Wpedantic -Werror)
endif()

set(INCLUDE_DIR ${CMAKE_SOURCE_DIR}/include)

add_library(cma_lexer STATIC
    src/lexer/CppLexer.cpp
    src/lexer/PythonLexer.cpp
    src/lexer/JavaLexer.cpp
    src/lexer/TypeScriptLexer.cpp
    src/lexer/JavaScriptLexer.cpp

)
target_include_directories(cma_lexer PUBLIC ${INCLUDE_DIR})

add_library(cma_filesystem STATIC
    src/filesystem/FileScanner.cpp
)
target_include_directories(cma_filesystem PUBLIC ${INCLUDE_DIR})

add_library(cma_vcs STATIC
    src/vcs/GitHistory.cpp
)
target_include_directories(cma_vcs PUBLIC ${INCLUDE_DIR})

add_library(cma_parser STATIC
    src/parser/CppParser.cpp
    src/parser/PythonParser.cpp
    src/parser/JavaParser.cpp
    src/parser/TypeScriptParser.cpp
    src/parser/JavaScriptParser.cpp
)
target_include_directories(cma_parser PUBLIC ${INCLUDE_DIR})
target_link_libraries(cma_parser PUBLIC cma_lexer)

add_library(cma_metrics STATIC
    src/metrics/MetricsEngine.cpp
)
target_include_directories(cma_metrics PUBLIC ${INCLUDE_DIR})
target_link_libraries(cma_metrics PUBLIC cma_parser cma_vcs)

add_library(cma_rules STATIC
    src/rules/CppRules.cpp
    src/rules/PythonRules.cpp
    src/rules/JavaRules.cpp
    src/rules/TypeScriptRules.cpp
    src/rules/JavaScriptRules.cpp
    
)
target_include_directories(cma_rules PUBLIC ${INCLUDE_DIR})
target_link_libraries(cma_rules PUBLIC cma_lexer cma_metrics)

add_library(cma_report STATIC
    src/report/ReportGenerator.cpp
    src/report/HealthScore.cpp
)
target_include_directories(cma_report PUBLIC ${INCLUDE_DIR})
target_link_libraries(cma_report PUBLIC cma_metrics)

add_executable(cma src/main.cpp)
target_link_options(cma PRIVATE -static)
target_link_libraries(cma PRIVATE
    cma_lexer
    cma_filesystem
    cma_parser
    cma_metrics
    cma_rules
    cma_report
    cma_vcs
)

if (CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS 9)
    target_link_libraries(cma PRIVATE stdc++fs)
    target_link_libraries(cma_filesystem PRIVATE stdc++fs)
endif()

option(CMA_BUILD_TESTS "Build the CMA characterization/unit test suite" ON)
if (CMA_BUILD_TESTS AND EXISTS ${CMAKE_SOURCE_DIR}/tests/CMakeLists.txt)
    enable_testing()
    add_subdirectory(tests)
endif()
