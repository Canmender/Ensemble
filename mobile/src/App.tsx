import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";

// 页面
import DashboardPage from "./pages/DashboardPage";
import TasksPage from "./pages/TasksPage";
import ChatPage from "./pages/ChatPage";
import AgentsPage from "./pages/AgentsPage";
import SettingsPage from "./pages/SettingsPage";

// 状态管理
import { useDeviceStore } from "./store/deviceStore";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// 底部标签导航
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: "#10b981",
        tabBarInactiveTintColor: "#6b7280",
        headerStyle: { backgroundColor: "#111827" },
        headerTintColor: "#fff",
        tabBarStyle: { backgroundColor: "#111827", borderTopColor: "#374151" },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardPage}
        options={{
          title: "看板",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📊</Text>,
        }}
      />
      <Tab.Screen
        name="Tasks"
        component={TasksPage}
        options={{
          title: "任务",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📋</Text>,
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatPage}
        options={{
          title: "聊天",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>💬</Text>,
        }}
      />
      <Tab.Screen
        name="Agents"
        component={AgentsPage}
        options={{
          title: "Agent",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🤖</Text>,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsPage}
        options={{
          title: "设置",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙️</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: "#10b981",
            background: "#111827",
            card: "#1f2937",
            text: "#ffffff",
            border: "#374151",
            notification: "#10b981",
          },
        }}
      >
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={MainTabs} />
        </Stack.Navigator>
        <StatusBar style="light" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
