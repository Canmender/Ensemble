import paramiko
import os

# 服务器配置
host = "47.92.39.184"
username = "root"
password = "2008716fzyFZY"

# 创建 SSH 客户端
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    # 连接服务器
    print("正在连接服务器...")
    client.connect(host, username=username, password=password)
    print("连接成功！")
    
    # 创建 SFTP 客户端
    sftp = client.open_sftp()
    
    # 上传 APK
    apk_path = "mobile/android/app/build/outputs/apk/release/app-release.apk"
    apk_remote = "/data/apk/ensemble-0.9.0.apk"
    
    print(f"正在上传 APK: {apk_path}")
    sftp.put(apk_path, apk_remote)
    print("APK 上传成功！")
    
    # 上传 EXE
    exe_path = "desktop/packages/desktop/release/ensemble-0.8.0-setup.exe"
    exe_remote = "/data/exe/ensemble-0.8.0-setup.exe"
    
    print(f"正在上传 EXE: {exe_path}")
    sftp.put(exe_path, exe_remote)
    print("EXE 上传成功！")
    
    # 关闭连接
    sftp.close()
    client.close()
    print("所有文件上传完成！")
    
except Exception as e:
    print(f"错误: {e}")
