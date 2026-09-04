include(FetchContent)
FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.15.2
)
set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

add_executable(cma_tests
    unit/test_python_lexer.cpp
    unit/test_python_parser.cpp
    unit/test_java_lexer.cpp
    unit/test_java_parser.cpp
    unit/test_typescript_lexer.cpp
    unit/test_typescript_parser.cpp
    unit/test_report_generator.cpp
    unit/test_dependency_graph.cpp
    unit/test_hotspot_and_health_score.cpp
    unit/test_rule_violations.cpp
    unit/test_html_report.cpp
    unit/test_file_scanner.cpp
    unit/test_metrics_engine.cpp
)

target_link_libraries(cma_tests PRIVATE
    gtest_main
    cma_lexer
    cma_filesystem
    cma_vcs
    cma_parser
    cma_metrics
    cma_rules
    cma_report
)

target_include_directories(cma_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)

include(GoogleTest)
gtest_discover_tests(cma_tests)
