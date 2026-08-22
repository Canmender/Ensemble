import paramiko
import os
import sys

host = "47.92.39.184"
username = "root"
password = "2008716fzyFZY"

# 检查本地文件
apk_path = "mobile/android/app/build/outputs/apk/release/app-release.apk"
exe_path = "desktop/packages/desktop/release/ensemble-0.8.0-setup.exe"

print(f"检查本地文件...")
print(f"APK 路径: {apk_path}")
print(f"APK 存在: {os.path.exists(apk_path)}")
print(f"EXE 路径: {exe_path}")
print(f"EXE 存在: {os.path.exists(exe_path)}")

if not os.path.exists(apk_path):
    print(f"错误: APK 文件不存在: {apk_path}")
    sys.exit(1)

if not os.path.exists(exe_path):
    print(f"错误: EXE 文件不存在: {exe_path}")
    sys.exit(1)

# 创建 SSH 客户端
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print(f"正在连接服务器 {host}...")
    client.connect(host, username=username, password=password)
    print("连接成功！")
    
    # 创建 SFTP 客户端
    sftp = client.open_sftp()
    
    # 上传 APK
    apk_remote = "/data/apk/ensemble-0.9.0.apk"
    print(f"正在上传 APK: {apk_path} -> {apk_remote}")
    sftp.put(apk_path, apk_remote)
    print("APK 上传成功！")
    
    # 上传 EXE
    exe_remote = "/data/exe/ensemble-0.8.0-setup.exe"
    print(f"正在上传 EXE: {exe_path} -> {exe_remote}")
    sftp.put(exe_path, exe_remote)
    print("EXE 上传成功！")
    
    # 关闭连接
    sftp.close()
    client.close()
    print("所有文件上传完成！")
    
except Exception as e:
    print(f"错误: {e}")
    sys.exit(1)
