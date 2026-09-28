import java.security.MessageDigest;
import javax.crypto.Cipher;
import java.sql.*;
import java.util.List;
public class A {
    public String password = "hunter2hunter2";
    public int count;
    void run(String in, Statement st) throws Exception {
        Runtime.getRuntime().exec(in);
        new ProcessBuilder(in);
        MessageDigest.getInstance("MD5");
        Cipher.getInstance("DES");
        st.executeQuery("SELECT * FROM t WHERE id = " + in);
        List raw = null;
        try { in.length(); } catch (Exception e) { }
        try { in.length(); } catch (Exception e) { e.printStackTrace(); }
    }
    class T implements javax.net.ssl.X509TrustManager {
        public void checkClientTrusted(java.security.cert.X509Certificate[] c, String a) {}
        public void checkServerTrusted(java.security.cert.X509Certificate[] c, String a) {}
        public java.security.cert.X509Certificate[] getAcceptedIssuers() { return null; }
    }
}
// TODO fix later
