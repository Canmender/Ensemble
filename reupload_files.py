import paramiko
import os

host = "47.92.39.184"
username = "root"
password = "2008716fzyFZY"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect(host, username=username, password=password)
    print("连接成功！")
    
    sftp = client.open_sftp()
    
    # 上传 APK
    apk_path = "mobile/android/app/build/outputs/apk/release/app-release.apk"
    apk_remote = "/data/apk/ensemble-0.9.0.apk"
    
    print(f"正在上传 APK: {apk_path}")
    if os.path.exists(apk_path):
        sftp.put(apk_path, apk_remote)
        print("APK 上传成功！")
    else:
        print(f"APK 文件不存在: {apk_path}")
    
    # 上传 EXE
    exe_path = "desktop/packages/desktop/release/ensemble-0.8.0-setup.exe"
    exe_remote = "/data/exe/ensemble-0.8.0-setup.exe"
    
    print(f"正在上传 EXE: {exe_path}")
    if os.path.exists(exe_path):
        sftp.put(exe_path, exe_remote)
        print("EXE 上传成功！")
    else:
        print(f"EXE 文件不存在: {exe_path}")
    
    sftp.close()
    client.close()
    print("上传完成！")
    
except Exception as e:
    print(f"错误: {e}")
