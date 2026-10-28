from setuptools import find_packages, setup

package_name = 'wrist_exo'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='rahilyn',
    maintainer_email='rsolyzia@outlook.com',
    description='Wrist exoskeleton ROS 2 nodes',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            'csv_logger = wrist_exo.csv_logger:main',
            'wrist_state = wrist_exo.wrist_state:main',
        ],
    },
)
