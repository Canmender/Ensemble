import paramiko
import json

host = "47.92.39.184"
username = "root"
password = "2008716fzyFZY"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect(host, username=username, password=password)
    print("连接成功！")
    
    # 创建 version.json 内容
    version_data = {
        "version": "0.9.0",
        "versionCode": 100,
        "apkUrl": "/apk/ensemble-v0.9.0.apk",
        "note": "更新说明",
        "force": False
    }
    
    # 将 JSON 转换为字符串
    version_json = json.dumps(version_data)
    
    # 使用 printf 命令写入文件（避免引号问题）
    command = f"docker exec ensemble-server sh -c \"printf '%s' '{version_json}' > /data/apk/version.json\""
    
    print(f"执行命令：{command}")
    stdin, stdout, stderr = client.exec_command(command)
    
    print("stdout:", stdout.read().decode())
    print("stderr:", stderr.read().decode())
    
    # 验证 version.json
    print("\n验证 version.json...")
    stdin, stdout, stderr = client.exec_command("docker exec ensemble-server cat /data/apk/version.json")
    print("version.json 内容：")
    print(stdout.read().decode())
    
    client.close()
    print("version.json 更新完成！")
    
except Exception as e:
    print(f"错误: {e}")
