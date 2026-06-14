import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, App as AntdApp } from 'antd';
import { LockOutlined, UserOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';

const { Title, Paragraph, Text } = Typography;

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore(s => s.login);
  const { message } = AntdApp.useApp();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      message.success('登录成功！');
      navigate('/contracts');
    } catch (e: any) {
      message.error(e.response?.data?.error || '登录失败，请检查用户名密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }}>
      <div style={{ display: 'flex', gap: 32, maxWidth: 1100, width: '100%' }}>
        <div style={{ flex: 1, color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SafetyCertificateOutlined style={{ fontSize: 64, marginBottom: 16 }} />
          <Title level={1} style={{ color: '#fff', margin: 0 }}>合同条款协同评审系统</Title>
          <Paragraph style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16, marginTop: 16, lineHeight: 1.8 }}>
            支持法务与业务双角色协同评审，版本冲突检测，完整决策日志与审计追踪。<br />
            条款编号稳定，建议合并/回滚一键操作，数据重启持久化完整一致。
          </Paragraph>
          <Card size="small" style={{ marginTop: 16, background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', borderColor: 'rgba(255,255,255,0.2)' }}>
            <Text style={{ color: '#fff' }}>
              <strong>测试账号：</strong><br />
              admin / admin123 &nbsp;&nbsp;（管理员）<br />
              legal1 / legal123 &nbsp;&nbsp;（法务）<br />
              business1 / biz123 &nbsp;&nbsp;（业务）
            </Text>
          </Card>
        </div>

        <Card style={{ width: 420, flexShrink: 0, borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <Title level={3} style={{ textAlign: 'center', marginBottom: 32 }}>用户登录</Title>
          <Form
            name="login"
            size="large"
            onFinish={onFinish}
            autoComplete="off"
            initialValues={{ username: 'admin', password: 'admin123' }}
          >
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading} block style={{ height: 46, fontWeight: 500 }}>
                登 录
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
