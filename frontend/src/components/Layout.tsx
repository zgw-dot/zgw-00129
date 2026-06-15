import React from 'react';
import { Layout, Menu, Avatar, Dropdown, Typography, Space, Badge } from 'antd';
import {
  FileTextOutlined,
  HistoryOutlined,
  ImportOutlined,
  LogoutOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  AuditOutlined,
  SwapOutlined
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

interface Props {
  children: React.ReactNode;
}

const MainLayout: React.FC<Props> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const selectedKey = (() => {
    if (location.pathname.startsWith('/countersigns')) return '/my-countersigns';
    if (location.pathname.startsWith('/my-countersigns')) return '/my-countersigns';
    if (location.pathname.startsWith('/handovers')) return '/handovers';
    if (location.pathname.startsWith('/contracts')) return '/contracts';
    if (location.pathname.startsWith('/clauses')) return '/contracts';
    if (location.pathname.startsWith('/audit-logs')) return '/audit-logs';
    if (location.pathname.startsWith('/import-guide')) return '/import-guide';
    return '/contracts';
  })();

  const roleIcon = (role: string) => {
    if (role === 'admin') return <SafetyCertificateOutlined />;
    if (role === 'legal') return <FileTextOutlined />;
    return <TeamOutlined />;
  };

  const menuItems = [
    { key: '/contracts', icon: <FileTextOutlined />, label: '合同管理', onClick: () => navigate('/contracts') },
    { key: '/my-countersigns', icon: <AuditOutlined />, label: '我的会签', onClick: () => navigate('/my-countersigns') },
    { key: '/handovers', icon: <SwapOutlined />, label: '评审交接', onClick: () => navigate('/handovers') },
    { key: '/audit-logs', icon: <HistoryOutlined />, label: '操作日志', onClick: () => navigate('/audit-logs') },
    { key: '/import-guide', icon: <ImportOutlined />, label: '导入格式说明', onClick: () => navigate('/import-guide') }
  ];

  const userMenu = {
    items: [
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: () => { logout(); navigate('/login'); } }
    ]
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        background: 'linear-gradient(135deg, #001529 0%, #002140 100%)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <Space>
          <FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />
          <Title level={4} style={{ color: '#fff', margin: 0 }}>合同条款协同评审系统</Title>
        </Space>
        <Dropdown menu={userMenu} placement="bottomRight">
          <Space style={{ cursor: 'pointer', color: '#fff' }}>
            <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#1677ff' }} />
            <span>{user?.display_name}</span>
            <Badge
              color={user?.role === 'admin' ? 'gold' : user?.role === 'legal' ? 'blue' : 'green'}
              text={<span style={{ fontSize: 12, opacity: 0.85 }}>{roleIcon(user?.role || '')} {ROLE_LABELS[user?.role || 'business']}</span>}
            />
          </Space>
        </Dropdown>
      </Header>
      <Layout>
        <Sider width={220} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ height: '100%', borderRight: 0, paddingTop: 16 }}
            items={menuItems}
          />
        </Sider>
        <Layout style={{ padding: '20px 24px', background: '#f5f7fa' }}>
          <Content style={{ background: '#fff', padding: 24, borderRadius: 8, minHeight: 'calc(100vh - 148px)' }}>
            {children}
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
