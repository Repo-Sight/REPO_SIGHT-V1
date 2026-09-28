using System;
using System.Diagnostics;
using System.Data.SqlClient;
using System.Security.Cryptography;
public class A {
    public string password = "hunter2hunter2";
    public int Count;
    public async void Run(string input) {
        Process.Start(input);
        var h = MD5.Create();
        var c = DES.Create();
        var cmd = new SqlCommand("SELECT * FROM t WHERE id = " + input);
        System.Net.ServicePointManager.ServerCertificateValidationCallback = (s, cert, chain, e) => true;
        Console.WriteLine(input);
        try { input.ToString(); } catch (Exception e) { }
    }
}
// TODO fix later
