#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <string>
void f(char* in) {
    char buf[8];
    strcpy(buf, in);
    system(in);
    FILE* p = popen(in, "r");
    int r = rand();
    std::string password = "hunter2hunter2";
    unsigned char d[16];
    MD5((unsigned char*)in, 3, d);
    int* q = new int(3);
    delete q;
    if (r == 42) { r = 1; }
    try { r = 2; } catch (...) { }
}
// TODO fix later
