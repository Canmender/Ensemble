import paramiko

host = "47.92.39.184"
username = "root"
password = "2008716fzyFZY"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect(host, username=username, password=password)
    print("连接成功！")
    
    # 验证 version.json
    print("\n验证 version.json...")
    stdin, stdout, stderr = client.exec_command("docker exec ensemble-server cat /data/apk/version.json")
    print("version.json 内容：")
    print(stdout.read().decode())
    print("stderr:", stderr.read().decode())
    
    # 验证 API
    print("\n验证 API...")
    stdin, stdout, stderr = client.exec_command("curl -s http://localhost:8787/api/app-version")
    print("API 返回：")
    print(stdout.read().decode())
    print(stderr.read().decode())
    
    client.close()
    
except Exception as e:
    print(f"错误: {e}")
